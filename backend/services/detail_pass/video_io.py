"""Video reading, size limits and color matching for "Enhance detail".

Two color traps found while testing, both handled here:

* ltx-pipelines' own frame reader converts to RGB with PyAV's default matrix, which made
  skin darker and less yellow on BT.709 clips before the model ever saw them.
* Even with a correct reader the model drifts a little. So the saved clip keeps the
  source's color planes and overall brightness, and takes only fine detail from the model.
  That is done on the stored YUV planes, with no RGB round trip.

Passing ``-colorspace`` as an ffmpeg output option on untagged raw input converts the
colors; tag with the ``setparams`` filter instead.
"""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import IO, Any, cast

import numpy as np
import numpy.typing as npt

from services.ltx_pipeline_common import OUTPUT_VIDEO_CRF, OUTPUT_VIDEO_PRESET

# Limits are what has actually been run on a 24 GB card. 1024x576 -> 2048x1152 stalled there.
MAX_FRAMES = 121  # 5 s at 24 fps
MAX_SAME_SIZE_PIXELS = 640_000  # 540p, including 1216x512 ultrawide
MAX_DOUBLED_SOURCE_PIXELS = 768 * 384
# Blur radius (source pixels) separating the source's tones from the model's fine detail.
_DETAIL_SIGMA = 8.0

FrameU8 = npt.NDArray[np.uint8]


@dataclass(frozen=True, slots=True)
class VideoInfo:
    width: int
    height: int
    frames: int
    fps: Fraction


def probe_video(path: str) -> VideoInfo:
    import av

    with av.open(path) as container:
        stream = container.streams.video[0]
        # Count packets rather than trusting the header, which some containers leave empty.
        frames = sum(1 for packet in container.demux(stream) if packet.size)
        rate = stream.average_rate or Fraction(24)
        return VideoInfo(
            width=int(stream.codec_context.width),
            height=int(stream.codec_context.height),
            frames=frames,
            fps=Fraction(rate),
        )


def unsupported_reason(info: VideoInfo, scale: int) -> str | None:
    """Why this clip can't be enhanced at ``scale`` (1 = same size, 2 = doubled), if it can't."""
    if info.frames < 9:
        return "The clip is too short to enhance."
    if info.frames > MAX_FRAMES:
        return f"Enhance detail works on clips up to 5 seconds ({MAX_FRAMES} frames); this one has {info.frames}."
    pixels = info.width * info.height
    size = f"{info.width}x{info.height}"
    if scale == 2:
        if pixels > MAX_DOUBLED_SOURCE_PIXELS:
            return f"2x works on clips up to 768x384; this one is {size}. Use Same size."
        if info.width % 32 or info.height % 32:
            return f"2x needs a width and height divisible by 32; this clip is {size}."
    else:
        if pixels > MAX_SAME_SIZE_PIXELS:
            return f"Same size works on clips up to 540p; this one is {size}."
        if info.width % 64 or info.height % 64:
            return f"Same size needs a width and height divisible by 64; this clip is {size}."
    return None


def padded_frame_count(frames: int) -> int:
    """The next 8k+1 count. The model needs that shape; the extra frames are cut on save."""
    return ((frames - 1 + 7) // 8) * 8 + 1


def _ffmpeg() -> str:
    import imageio_ffmpeg

    return str(imageio_ffmpeg.get_ffmpeg_exe())


def _raw_frames(path: str, video_filter: str, frame_bytes: int) -> Iterator[bytes]:
    process = subprocess.Popen(
        [_ffmpeg(), "-loglevel", "error", "-i", path, "-map", "0:v:0", "-vf", video_filter,
         "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE,
    )
    stdout = cast(IO[bytes], process.stdout)
    try:
        while True:
            data = stdout.read(frame_bytes)
            if len(data) < frame_bytes:
                break
            yield data
    finally:
        stdout.close()
        process.kill()
        process.wait()


def iter_rgb_frames(path: str, info: VideoInfo, count: int) -> Iterator[FrameU8]:
    """``count`` RGB frames converted with BT.709, repeating the last one if the clip is shorter."""
    last: FrameU8 | None = None
    produced = 0
    video_filter = "scale=in_color_matrix=bt709:out_range=pc,format=rgb24"
    for data in _raw_frames(path, video_filter, info.width * info.height * 3):
        if produced == count:
            break
        last = np.frombuffer(bytearray(data), dtype=np.uint8).reshape(info.height, info.width, 3)
        produced += 1
        yield last
    if last is None:
        raise ValueError(f"No video frames could be read from {Path(path).name}")
    for _ in range(count - produced):
        yield last


def save_with_source_color(source_path: str, enhanced_path: str, output_path: str, *, scale: int) -> None:
    """Write the enhanced clip with the source's color, tones, frame count and audio."""
    import cv2

    info = probe_video(source_path)
    width, height = info.width * scale, info.height * scale
    luma_bytes = width * height
    frame_bytes = luma_bytes * 3 // 2
    # YUV to YUV: scaling (for 2x) and range only, never a matrix conversion.
    source = _raw_frames(source_path, f"scale={width}:{height}:flags=lanczos:out_range=tv,format=yuv420p", frame_bytes)
    enhanced = _raw_frames(enhanced_path, "format=yuv420p", frame_bytes)
    encoder = subprocess.Popen(
        [_ffmpeg(), "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", f"{width}x{height}", "-r", str(info.fps), "-i", "-",
         "-i", source_path, "-map", "0:v", "-map", "1:a?",
         "-vf", "setparams=colorspace=bt709:range=tv",
         "-c:v", "libx264", "-crf", str(OUTPUT_VIDEO_CRF), "-preset", OUTPUT_VIDEO_PRESET,
         "-pix_fmt", "yuv420p", "-c:a", "copy", output_path],
        stdin=subprocess.PIPE,
    )
    stdin = cast(IO[bytes], encoder.stdin)
    written = 0
    try:
        for original, detailed in zip(source, enhanced):
            if written == info.frames:
                break
            source_y = np.frombuffer(original, np.uint8, luma_bytes).reshape(height, width).astype(np.float32)
            detail_y = np.frombuffer(detailed, np.uint8, luma_bytes).reshape(height, width).astype(np.float32)
            blurred = cast(Any, cv2).GaussianBlur(source_y - detail_y, (0, 0), _DETAIL_SIGMA * scale)
            luma = np.clip(detail_y + blurred + 0.5, 0, 255).astype(np.uint8)
            stdin.write(luma.tobytes())
            stdin.write(original[luma_bytes:])
            written += 1
    finally:
        stdin.close()
        return_code = encoder.wait()
        source.close()  # type: ignore[attr-defined]
        enhanced.close()  # type: ignore[attr-defined]
    if return_code != 0 or written != info.frames:
        Path(output_path).unlink(missing_ok=True)
        raise RuntimeError(f"Saving the enhanced clip failed ({written}/{info.frames} frames, ffmpeg {return_code})")
