"""FORK: Enhance detail (the DFR detail LoRA over a finished clip)."""

from __future__ import annotations

import subprocess

import av
import imageio_ffmpeg
import numpy as np

from runtime_config.model_download_specs import DFR_DETAIL_LORA_FILENAME
from services.detail_pass.video_io import (
    VideoInfo,
    iter_rgb_frames,
    padded_frame_count,
    probe_video,
    save_with_source_color,
    unsupported_reason,
)


def _clip(path, *, size="256x128", frames=16, color="0xc08060", audio=False):
    command = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
               "-f", "lavfi", "-i", f"color=c={color}:s={size}:r=24"]
    if audio:
        command += ["-f", "lavfi", "-i", "sine=frequency=440", "-shortest", "-c:a", "aac"]
    command += ["-frames:v", str(frames), "-vf", "format=yuv420p,setparams=colorspace=bt709:range=tv",
                "-c:v", "libx264", "-crf", "10", str(path)]
    subprocess.run(command, check=True)
    return str(path)


def _planes(path):
    with av.open(path) as container:
        return np.stack([f.to_ndarray(format="yuv420p") for f in container.decode(video=0)]).astype(np.float32)


def test_size_and_length_limits():
    def reason(w, h, frames, scale):
        return unsupported_reason(VideoInfo(w, h, frames, 24), scale)

    assert reason(1024, 576, 121, 1) is None
    assert reason(768, 384, 121, 2) is None
    assert reason(1024, 576, 121, 2) is not None  # stalled a 24 GB card
    assert reason(1280, 704, 121, 1) is not None  # 720p is untested
    assert reason(1024, 576, 145, 1) is not None
    assert reason(960, 544, 121, 1) is not None  # not divisible by 64
    assert [padded_frame_count(n) for n in (9, 120, 121)] == [9, 121, 121]


def test_reader_pads_by_repeating_the_last_frame(tmp_path):
    path = _clip(tmp_path / "a.mp4", frames=14)
    info = probe_video(path)
    assert (info.width, info.height, info.frames) == (256, 128, 14)
    frames = list(iter_rgb_frames(path, info, padded_frame_count(info.frames)))
    assert len(frames) == 17
    assert np.array_equal(frames[-1], frames[13])


def test_saved_clip_keeps_source_color_brightness_length_and_audio(tmp_path):
    source = _clip(tmp_path / "source.mp4", frames=14, audio=True)
    # A stand-in for model output that drifted darker and redder, with its padding frames.
    drifted = _clip(tmp_path / "drifted.mp4", frames=17, color="0xa05040")
    for scale in (1, 2):
        enhanced = drifted if scale == 1 else _clip(tmp_path / "big.mp4", size="512x256", frames=17, color="0xa05040")
        output = str(tmp_path / f"out{scale}.mp4")
        save_with_source_color(source, enhanced, output, scale=scale)

        info = probe_video(output)
        assert (info.width, info.height, info.frames) == (256 * scale, 128 * scale, 14)
        before, after = _planes(source), _planes(output)
        luma_rows, out_rows = 128, 128 * scale
        assert abs(after[:, :out_rows].mean() - before[:, :luma_rows].mean()) < 1.0
        assert abs(after[:, out_rows:].mean() - before[:, luma_rows:].mean()) < 1.0
        with av.open(output) as container:
            assert len(container.streams.audio) == 1


def _install_detail_lora(models_dir):
    path = models_dir / "ltx-2.5" / DFR_DETAIL_LORA_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"lora")
    return path


def test_endpoint_runs_the_pass_with_only_the_action_part_of_the_prompt(
    client, test_state, fake_services, create_fake_model_files, tmp_path
):
    create_fake_model_files()
    test_state.state.app_settings.use_local_text_encoder = True
    lora = _install_detail_lora(test_state.video_generation.models_dir)
    source = _clip(tmp_path / "clip.mp4")

    response = client.post(
        "/api/enhance-detail",
        json={"videoPath": source, "prompt": "Reference sheet: an alien. Generated video: he walks.",
              "method": "rebuild", "scale": 2, "seed": 7},
    )

    assert response.status_code == 200, response.text
    call = fake_services.fast_video_pipeline.enhance_calls[-1]
    assert (call["prompt"], call["method"], call["scale"], call["seed"]) == ("he walks.", "rebuild", 2, 7)
    assert call["detail_lora_path"] == str(lora)


def test_endpoint_rejects_too_big_clips_and_a_missing_lora(
    client, test_state, fake_services, create_fake_model_files, tmp_path
):
    create_fake_model_files()
    source = _clip(tmp_path / "wide.mp4", size="1024x576")

    missing = client.post("/api/enhance-detail", json={"videoPath": source})
    assert (missing.status_code, missing.json()["code"]) == (409, "DFR_NOT_AVAILABLE")

    _install_detail_lora(test_state.video_generation.models_dir)
    too_big = client.post("/api/enhance-detail", json={"videoPath": source, "scale": 2})
    assert (too_big.status_code, too_big.json()["code"]) == (422, "ENHANCE_UNSUPPORTED_CLIP")
    assert not getattr(fake_services.fast_video_pipeline, "enhance_calls", [])
