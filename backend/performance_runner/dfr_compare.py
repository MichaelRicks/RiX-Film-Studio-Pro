#!/usr/bin/env python3
"""Standalone A/B test: RiX's current LTX 2.5 fast pipeline vs. upstream DFRPipeline.

Nothing in the app is changed. The script imports ltx2_server so both sides run with
the same patches, SageAttention, streaming mode, settings and text encoding as the
app (including the LTX API for prompts, if that is what the app is set to use).

Each pipeline runs in its own process, so one cannot warm up or fill VRAM for the
other. With --runs 1 (default) every time is a cold start; compare cold with cold.

Close RiX first. Usage (from the backend folder):
    .venv\\Scripts\\python.exe performance_runner\\dfr_compare.py --check
    .venv\\Scripts\\python.exe performance_runner\\dfr_compare.py
    .venv\\Scripts\\python.exe performance_runner\\dfr_compare.py --prompts all

Modes: "fast" (current), "dfr" (needs the detail LoRA), "dfr-nolora" (smoke test of
the DFR code path without the LoRA; not a fair quality comparison).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
DETAIL_LORA_NAME = "ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors"
MODES = ("fast", "dfr", "dfr-nolora")
# Windows spills to slow shared memory instead of failing, so refuse to start on a busy GPU.
MIN_FREE_VRAM_GB = 20.0

PROMPTS = {
    "face": (
        "A close-up of a woman in her thirties by a window in soft afternoon light. She looks "
        "down, then slowly raises her eyes to the camera and gives a small smile. Fine skin "
        "texture and loose strands of hair are visible. The camera holds still. Quiet room tone."
    ),
    "motion": (
        "A cyclist in a yellow jacket rides fast along a wet city street from left to right, "
        "spraying water from the rear wheel. The camera pans to follow. Shop windows and parked "
        "cars pass behind. The hiss of tires on wet pavement and distant traffic."
    ),
    "two": (
        "A medium shot of two people at a cafe table. On the left, a young woman with short black "
        "hair in a red sweater lifts a cup and takes a sip. On the right, an older bald man with a "
        "gray beard in a green jacket nods slowly. The camera holds still. Soft cafe chatter."
    ),
}


def _app_data_dir() -> Path:
    env = os.environ.get("LTX_APP_DATA_DIR")
    return Path(env) if env else Path(os.environ["LOCALAPPDATA"]) / "LTXDesktop"


def _models_dir() -> Path:
    settings_file = _app_data_dir() / "settings.json"
    if settings_file.is_file():
        custom = json.loads(settings_file.read_text(encoding="utf-8")).get("models_dir")
        if custom:
            return Path(custom)
    return _app_data_dir() / "models"


def _safetensors_keys(path: Path) -> list[str]:
    import struct

    with path.open("rb") as handle:
        length = struct.unpack("<Q", handle.read(8))[0]
        header = json.loads(handle.read(length))
    return [key for key in header if key != "__metadata__"]


def _lora_key_match(lora_path: Path, checkpoint_path: Path) -> tuple[int, int]:
    """(LoRA layers that name a transformer weight, total LoRA layers).

    LoRA fusion skips names it does not recognise without failing, which would make a
    "DFR with LoRA" run silently equal to one without it.
    """
    from ltx_core.loader.sd_ops import LTXV_LORA_COMFY_RENAMING_MAP

    targets: set[str] = set()
    for key in _safetensors_keys(lora_path):
        if ".lora_A." not in key:
            continue
        renamed = LTXV_LORA_COMFY_RENAMING_MAP.apply_to_key(key)
        if renamed is not None:
            targets.add(renamed.split(".lora_A.")[0] + ".weight")
    base = {
        key.removeprefix("model.").removeprefix("diffusion_model.")
        for key in _safetensors_keys(checkpoint_path)
    }
    return len(targets & base), len(targets)


def _load_backend() -> Any:
    """Import the real backend (patches, SageAttention, settings) without starting the server."""
    os.environ["LTX_APP_DATA_DIR"] = str(_app_data_dir())
    sys.path.insert(0, str(BACKEND_DIR))
    import ltx2_server

    return ltx2_server


def run_worker(args: argparse.Namespace) -> int:
    server = _load_backend()
    import torch

    handler = server.handler
    result: dict[str, Any] = {"mode": args.worker, "prompt_id": args.prompt_id, "runs": []}
    result_path = Path(args.result)

    def save() -> None:
        result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    try:
        if not args.check:
            free, _total = torch.cuda.mem_get_info()
            free_gb = free / 1024**3
            if free_gb < MIN_FREE_VRAM_GB and not args.force:
                raise RuntimeError(
                    f"Only {free_gb:.1f} GB of VRAM is free. Close RiX and other GPU apps, "
                    "or pass --force."
                )

        # Also installs the API text-encoding patches that DFR's PromptEncoder relies on.
        # Building the wrapper loads no large weights.
        state = handler.pipelines.load_gpu_pipeline("fast", loras=[])
        fast = state.pipeline
        use_local = handler.text.should_use_local_encoding()
        result["text_encoding"] = "local" if use_local else "api"
        if not use_local and not handler.state.app_settings.ltx_api_key:
            raise RuntimeError("No LTX API key and no local text encoder; set one up in RiX first.")

        dfr = None
        if args.worker != "fast":
            from ltx_core.loader.primitives import LoraPathStrengthAndSDOps
            from ltx_core.loader.sd_ops import LTXV_LORA_COMFY_RENAMING_MAP
            from ltx_pipelines.dfr_pipeline import DFRPipeline

            from services.ltx_pipeline_common import build_model_paths

            detailing = []
            if args.worker == "dfr":
                lora_path = Path(args.detailing_lora)
                if not lora_path.is_file():
                    raise FileNotFoundError(f"Detail LoRA not found: {lora_path}")
                matched, total = _lora_key_match(lora_path, Path(fast._checkpoint_path))
                result["lora_layers_matched"] = f"{matched}/{total}"
                print(f"[dfr-test] Detail LoRA layers matching the model: {matched}/{total}", flush=True)
                if total == 0 or matched < total:
                    raise RuntimeError(
                        f"Detail LoRA does not fully match this model ({matched}/{total} layers)."
                    )
                detailing = [
                    LoraPathStrengthAndSDOps(
                        path=str(lora_path),
                        strength=args.lora_strength,
                        sd_ops=LTXV_LORA_COMFY_RENAMING_MAP,
                    )
                ]
            model_paths = build_model_paths(
                fast._checkpoint_path,
                fast._gemma_root,
                video_vae_path=fast._video_vae_path,
                audio_vae_path=fast._audio_vae_path,
                duration_head_path=fast._duration_head_path,
            )
            # 1.2.0 was written for a full model plus a distilled LoRA. RiX's transformer is
            # already distilled, so that list stays empty.
            dfr = DFRPipeline(
                model_paths=model_paths,
                distilled_lora=[],
                spatial_upsampler_path=fast._upsampler_path,
                loras=[],
                detailing_lora=detailing,
                device=fast._device,
                quantization=fast._quantization,
                offload_mode=fast._offload_mode,
            )

        if args.check:
            result["ok"] = True
            save()
            return 0

        images = []
        image_path = None
        if args.image:
            from PIL import Image

            prepared: Image.Image = handler.video_generation._prepare_image(
                args.image, args.width, args.height
            )
            image_path = result_path.with_suffix(".start.png")
            prepared.save(image_path)

        from api_types import ImageConditioningInput
        from services.ltx_pipeline_common import (
            auto_tiling_config,
            encode_video_output,
            video_chunks_number,
        )

        if image_path is not None:
            images = [ImageConditioningInput(path=str(image_path), frame_idx=0, strength=1.0)]

        for run_index in range(1, args.runs + 1):
            output = result_path.with_name(f"{args.prompt_id}_{args.worker}_run{run_index}.mp4")
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            handler.text.prepare_text_encoding(args.prompt_text, enhance_prompt=False)
            with torch.inference_mode():
                if dfr is None:
                    fast.generate(
                        prompt=args.prompt_text,
                        seed=args.seed,
                        height=args.height,
                        width=args.width,
                        num_frames=args.frames,
                        frame_rate=24,
                        images=images,
                        output_path=str(output),
                    )
                else:
                    from ltx_pipelines.utils.args import ImageConditioningInput as LtxImageInput

                    video, audio, frames, tiling = dfr(
                        prompt=args.prompt_text,
                        seed=args.seed,
                        height=args.height,
                        width=args.width,
                        num_frames=args.frames,
                        frame_rate=24,
                        images=[LtxImageInput(i.path, i.frame_idx, i.strength) for i in images],
                        tiling_config=auto_tiling_config(),
                    )
                    encode_video_output(
                        video=video,
                        audio=audio,
                        fps=24,
                        output_path=str(output),
                        video_chunks_number_value=video_chunks_number(frames, tiling),
                    )
            run = {
                "run": run_index,
                "seconds": round(time.perf_counter() - started, 1),
                # Decode can reset allocator stats; treat this as a lower bound.
                "peak_vram_reserved_gb": round(torch.cuda.max_memory_reserved() / 1024**3, 1),
                "output": str(output),
            }
            result["runs"].append(run)
            save()
            print(f"[dfr-test] {args.worker} run {run_index}: {run['seconds']}s -> {output}", flush=True)

        result["ok"] = True
        save()
        return 0
    except BaseException as exc:
        result["ok"] = False
        result["error"] = f"{type(exc).__name__}: {exc}"
        save()
        traceback.print_exc()
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--modes", nargs="+", choices=MODES, default=["fast", "dfr"])
    parser.add_argument("--prompts", choices=("one", "all"), default="one", help="'one' = face only")
    parser.add_argument("--prompt", help="your own prompt (replaces the built-in ones)")
    parser.add_argument("--image", help="optional start image")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=576)
    parser.add_argument("--frames", type=int, default=121, help="8k+1; 121 = 5 s at 24 fps")
    parser.add_argument("--runs", type=int, default=1, help="runs per process; run 2+ is warm")
    parser.add_argument("--detailing-lora", default=str(_models_dir() / "ltx-2.5" / DETAIL_LORA_NAME))
    parser.add_argument("--lora-strength", type=float, default=0.5)
    parser.add_argument("--out", help="output folder")
    parser.add_argument("--check", action="store_true", help="verify setup only; generates nothing")
    parser.add_argument("--force", action="store_true", help="run even if VRAM is already in use")
    parser.add_argument("--worker", choices=MODES, help=argparse.SUPPRESS)
    parser.add_argument("--prompt-id", help=argparse.SUPPRESS)
    parser.add_argument("--prompt-text", help=argparse.SUPPRESS)
    parser.add_argument("--result", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.width % 64 or args.height % 64:
        parser.error("--width and --height must be multiples of 64")
    if (args.frames - 1) % 8:
        parser.error("--frames must be 8k+1")
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    if args.image:
        args.image = str(Path(args.image).resolve())
    return args


def main() -> int:
    args = parse_args()
    if args.worker:
        return run_worker(args)

    modes = list(args.modes)
    if "dfr" in modes and not Path(args.detailing_lora).is_file():
        print(f"Detail LoRA not found, skipping 'dfr':\n  {args.detailing_lora}")
        modes.remove("dfr")
        if args.check and "dfr-nolora" not in modes:
            modes.append("dfr-nolora")
        elif not args.check:
            print("Download it, or run: --modes fast dfr-nolora")
            return 2

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out) if args.out else _app_data_dir() / "outputs" / "dfr-test" / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.prompt:
        prompts = {"custom": args.prompt}
    elif args.prompts == "all" and not args.check:
        prompts = PROMPTS
    else:
        prompts = {"face": PROMPTS["face"]}

    results: list[dict[str, Any]] = []
    for prompt_id, prompt_text in prompts.items():
        for mode in modes:
            result_path = out_dir / f"{prompt_id}_{mode}.json"
            command = [
                sys.executable, str(Path(__file__).resolve()),
                "--worker", mode,
                "--prompt-id", prompt_id,
                f"--prompt-text={prompt_text}",
                "--result", str(result_path),
                "--seed", str(args.seed),
                "--width", str(args.width),
                "--height", str(args.height),
                "--frames", str(args.frames),
                "--runs", str(args.runs),
                "--detailing-lora", args.detailing_lora,
                "--lora-strength", str(args.lora_strength),
            ]
            if args.image:
                command += ["--image", args.image]
            if args.check:
                command.append("--check")
            if args.force:
                command.append("--force")
            print(f"\n===== {prompt_id} / {mode} =====", flush=True)
            subprocess.run(command, cwd=BACKEND_DIR, check=False)
            if result_path.is_file():
                results.append(json.loads(result_path.read_text(encoding="utf-8")))
            else:
                results.append({"mode": mode, "prompt_id": prompt_id, "ok": False,
                                "error": "process ended without writing a result"})

    lines = [
        f"DFR test  seed={args.seed}  {args.width}x{args.height}  {args.frames} frames",
        f"{'prompt':<8} {'mode':<11} {'run':<4} {'seconds':>8} {'peak GB':>8}  status",
    ]
    for item in results:
        runs = item.get("runs") or [{}]
        for run in runs:
            lines.append(
                f"{item['prompt_id']:<8} {item['mode']:<11} {run.get('run', '-')!s:<4} "
                f"{run.get('seconds', '-')!s:>8} {run.get('peak_vram_reserved_gb', '-')!s:>8}  "
                f"{'ok' if item.get('ok') else item.get('error', 'failed')}"
            )
    summary = "\n".join(lines)
    (out_dir / "summary.txt").write_text(summary + "\n", encoding="utf-8")
    print(f"\n{summary}\n\nOutput folder: {out_dir}")
    return 0 if results and all(item.get("ok") for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
