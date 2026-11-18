from __future__ import annotations

import json
import uuid
from pathlib import Path

import aiohttp
import folder_paths

from ._ignis import (
    IgnisClient as _IgnisClient,
    client_timeout,
    check_cancel,
    download_media,
    failure_message as _failure_message,
    load_ignis_config,
    output_filename,
    report_progress,
    upload_values as _upload_values,
    values as _values,
)
from ._media_paths import path_to_view_url
from .base import Runner, RunnerContext

MODE_TEXT = "\u6587\u751f\u89c6\u9891"
MODE_IMAGE = "\u56fe\u751f\u89c6\u9891"
MODE_TRANSITION = "\u9996\u5c3e\u5e27"
MODE_OMNI = "\u5168\u80fd\u53c2\u8003"
MODE_ALIASES = {
    "prompt": MODE_TEXT,
    "image": MODE_IMAGE,
    "transition": MODE_TRANSITION,
    "omni": MODE_OMNI,
}


def _display_aspect_ratio(value: str) -> str:
    return "auto" if value == "adaptive" else value


def _canonical_aspect_ratio(value: str) -> str:
    return "adaptive" if value == "auto" else value


def _display_resolution(value: str) -> str:
    return value.upper()


def _canonical_resolution(value: str) -> str:
    return value.lower()


def _coerce_duration(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _batch_size(value) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = 1
    if not 1 <= count <= 8:
        raise RuntimeError("Ignis video batch size must be between 1 and 8.")
    return count


def _build_batch_payload(request: dict, batch_size: int) -> dict:
    if batch_size == 1:
        return request
    return {"requests": [dict(request) for _ in range(batch_size)]}


def _collect_media_items(value) -> list[dict]:
    if isinstance(value, list):
        out: list[dict] = []
        for item in value:
            out.extend(_collect_media_items(item))
        return out
    if not isinstance(value, dict):
        return []
    if value.get("file_id") or value.get("url"):
        return [value]
    out: list[dict] = []
    for key in ("output", "outputs", "video", "videos", "result", "results", "files"):
        if key in value:
            out.extend(_collect_media_items(value[key]))
    return out


def _resolve_mode(spec: dict, value: str, *, images=0, videos=0, audio=0) -> str:
    mode = MODE_ALIASES.get(value, value)
    if mode in spec["modes"]:
        return mode
    if (videos or audio) and MODE_OMNI in spec["modes"]:
        return MODE_OMNI
    if images >= 2 and MODE_TRANSITION in spec["modes"]:
        return MODE_TRANSITION
    if images == 1 and MODE_IMAGE in spec["modes"]:
        return MODE_IMAGE
    return str(spec["default_mode"])

IGNIS_VIDEO_SPECS = {
    "seedance-2-5": {
        "label": "Ignis Seedance 2.5",
        "description": "Ignis Seedance 2.5 remote video generation.",
        "modes": [MODE_TEXT, MODE_IMAGE, MODE_TRANSITION, MODE_OMNI],
        "default_mode": MODE_TEXT,
        "aspect_ratios": ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
        "default_aspect_ratio": "16:9",
        "resolutions": ["480p", "720p", "1080p"],
        "default_resolution": "720p",
        "duration": {"min": 4, "max": 30, "default": 5},
        "max_images": 30,
        "max_videos": 10,
        "max_audio": 10,
    },
    "kling": {
        "label": "Ignis Kling",
        "description": "Ignis Kling remote video generation.",
        "modes": [MODE_TEXT, MODE_IMAGE, MODE_TRANSITION],
        "default_mode": MODE_TEXT,
        "max_images": 2,
        "max_videos": 0,
        "max_audio": 0,
    },
    "sora": {
        "label": "Ignis Sora",
        "description": "Ignis Sora remote video generation.",
        "modes": [MODE_TEXT, MODE_IMAGE],
        "default_mode": MODE_TEXT,
        "aspect_ratios": ["16:9", "9:16"],
        "default_aspect_ratio": "16:9",
        "max_images": 1,
        "max_videos": 0,
        "max_audio": 0,
    },
    "pixverse": {
        "label": "Ignis PixVerse",
        "description": "Ignis PixVerse remote video generation.",
        "modes": [MODE_IMAGE, MODE_TRANSITION],
        "default_mode": MODE_IMAGE,
        "max_images": 2,
        "max_videos": 0,
        "max_audio": 0,
    },
}



async def _download_video(
    session: aiohttp.ClientSession, item: dict, destination: Path
) -> None:
    await download_media(session, item, destination, media_label="video")


def _build_payload(
    *,
    prompt: str,
    model: str,
    mode: str,
    aspect_ratio: str,
    resolution: str,
    duration_s: int,
    file_ids: list[str],
    tail_file_ids: list[str],
    video_urls: list[str],
    audio_urls: list[str],
) -> dict:
    spec = IGNIS_VIDEO_SPECS[model]
    mode = _resolve_mode(
        spec,
        mode,
        images=len(file_ids) + len(tail_file_ids),
        videos=len(video_urls),
        audio=len(audio_urls),
    )

    if mode == MODE_TEXT:
        if file_ids or tail_file_ids or video_urls or audio_urls:
            raise RuntimeError("Text-to-video mode does not accept references.")
    elif mode == MODE_IMAGE:
        if len(file_ids) != 1 or tail_file_ids or video_urls or audio_urls:
            raise RuntimeError("Image-to-video mode requires exactly one image.")
    elif mode == MODE_TRANSITION:
        if len(file_ids) != 1 or len(tail_file_ids) != 1:
            raise RuntimeError(
                "Start/end-frame mode requires one start image and one end image."
            )
        if video_urls or audio_urls:
            raise RuntimeError(
                "Start/end-frame mode does not accept video or audio references."
            )
    elif mode == MODE_OMNI:
        if not file_ids:
            raise RuntimeError("Omni-reference mode requires at least one image.")
        for values, key, label in (
            (file_ids, "max_images", "reference images"),
            (video_urls, "max_videos", "reference videos"),
            (audio_urls, "max_audio", "reference audio files"),
        ):
            if len(values) > int(spec[key]):
                raise RuntimeError(
                    f"{model} supports at most {spec[key]} {label}."
                )

    payload = {"model": model, "prompt": prompt}
    if spec.get("aspect_ratios"):
        aspect_ratio = _canonical_aspect_ratio(aspect_ratio)
        if aspect_ratio not in spec["aspect_ratios"]:
            aspect_ratio = str(spec["default_aspect_ratio"])
        payload["aspect_ratio"] = aspect_ratio
    if spec.get("resolutions"):
        resolution = _canonical_resolution(resolution)
        if resolution not in spec["resolutions"]:
            resolution = str(spec["default_resolution"])
        payload["resolution"] = resolution
    if spec.get("duration"):
        duration = spec["duration"]
        duration_s = _coerce_duration(duration_s, int(duration["default"]))
        if not int(duration["min"]) <= duration_s <= int(duration["max"]):
            duration_s = int(duration["default"])
        payload["duration"] = duration_s

    if file_ids:
        payload["file_ids"] = file_ids
    if tail_file_ids:
        payload["tail_file_ids"] = tail_file_ids
    if video_urls:
        payload["video_urls"] = video_urls
    if audio_urls:
        payload["audio_urls"] = audio_urls
    return payload


def _widget(
    name: str,
    type_: str,
    props: dict,
    current,
) -> dict:
    return {
        "node_id": "ignis",
        "node_title": "Ignis",
        "node_type": "IgnisVideoRunner",
        "group_title": None,
        "widget_name": name,
        "widget_type": type_,
        "widget_props": props,
        "current_value": current,
        "stage_binding": f"option:{name}",
        "override_value": None,
        "cast": "int" if type_ == "INT" else None,
        "required": False,
    }


class IgnisVideoRunner(Runner):
    def __init__(self, model: str):
        spec = IGNIS_VIDEO_SPECS[model]
        super().__init__(f"ignis-video/{model}", str(spec["label"]), {"video"})
        self.model = model
        self.spec = spec

    def workflow_config(self) -> dict:
        widgets = [
            _widget(
                "mode",
                "COMBO",
                {"values": list(self.spec["modes"])},
                self.spec["default_mode"],
            )
        ]
        if self.spec.get("aspect_ratios"):
            widgets.append(
                _widget(
                    "aspect_ratio",
                    "COMBO",
                    {
                        "values": [
                            _display_aspect_ratio(value)
                            for value in self.spec["aspect_ratios"]
                        ]
                    },
                    _display_aspect_ratio(self.spec["default_aspect_ratio"]),
                )
            )
        if self.spec.get("resolutions"):
            widgets.append(
                _widget(
                    "resolution",
                    "COMBO",
                    {
                        "values": [
                            _display_resolution(value)
                            for value in self.spec["resolutions"]
                        ]
                    },
                    _display_resolution(self.spec["default_resolution"]),
                )
            )
        if self.spec.get("duration"):
            duration = self.spec["duration"]
            widgets.append(
                _widget(
                    "duration_s",
                    "INT",
                    {
                        "min": duration["min"],
                        "max": duration["max"],
                        "step": 1,
                    },
                    duration["default"],
                )
            )
        widgets.append(
            _widget(
                "batch_size",
                "INT",
                {"min": 1, "max": 8, "step": 1},
                1,
            )
        )
        return {
            "id": -list(IGNIS_VIDEO_SPECS).index(self.model) - 1,
            "kind": "video",
            "label": self.label,
            "link_type": 0,
            "file_path": "",
            "file_exists": False,
            "has_api": False,
            "description": self.spec["description"],
            "gui_notes": [],
            "gui_nodes": [],
            "exposed_widgets": widgets,
            "bindings": [
                {
                    "node_id": "ignis",
                    "input_name": widget["widget_name"],
                    "from": widget["stage_binding"],
                    "default": str(widget["current_value"]),
                    "prefix": None,
                    "suffix": None,
                    "required": False,
                    "error_msg": None,
                    "cast": widget["cast"],
                }
                for widget in widgets
            ],
            "meta": {
                "virtual": True,
                "remote_provider": "ignis",
                "model": self.model,
                "bound_only_params": True,
            },
        }

    def workflow_usage(self) -> dict:
        max_images = int(self.spec["max_images"])
        max_videos = int(self.spec["max_videos"])
        max_audio = int(self.spec["max_audio"])
        options = {"mode": True, "batch_size": True}
        for key in ("aspect_ratio", "resolution", "duration_s"):
            if any(w["widget_name"] == key for w in self.workflow_config()["exposed_widgets"]):
                options[key] = True
        return {
            "uses": {
                "image": max_images > 0,
                "video": max_videos > 0,
                "audio": max_audio > 0,
                "text": True,
                "model": False,
            },
            "requires": {key: False for key in ("image", "video", "audio", "text", "model")},
            "required_slots": {key: [] for key in ("image", "video", "audio", "text", "model")},
            "max_inputs": {
                "image": max_images,
                "video": max_videos,
                "audio": max_audio,
                "text": None,
                "model": 0,
            },
            "uses_computed": {"width": False, "height": False, "length": False},
            "uses_options": options,
            "uses_mask": False,
            "prompt_required": True,
        }

    async def invoke(self, ctx: RunnerContext):
        prompt = str(ctx.main_prompt or "").strip()
        if not prompt:
            raise RuntimeError("Ignis Video requires a prompt.")

        images = _values(ctx.upstream.get("images"))
        videos = _values(ctx.upstream.get("videos"))
        audio = _values(ctx.upstream.get("audio"))
        mode = _resolve_mode(
            self.spec,
            str(ctx.options.get("mode") or self.spec["default_mode"]),
            images=len(images),
            videos=len(videos),
            audio=len(audio),
        )
        batch_size = _batch_size(ctx.options.get("batch_size"))

        if mode == MODE_TEXT and (images or videos or audio):
            raise RuntimeError("Text-to-video mode does not accept reference media.")
        if mode == MODE_IMAGE and (len(images) != 1 or videos or audio):
            raise RuntimeError("Image-to-video mode requires exactly one image.")
        if mode == MODE_TRANSITION and (len(images) != 2 or videos or audio):
            raise RuntimeError("Start/end-frame mode requires exactly two images.")
        if mode == MODE_OMNI and not images:
            raise RuntimeError("Omni-reference mode requires at least one image.")

        base_url, token = load_ignis_config()
        client = _IgnisClient(base_url, token)
        timeout = client_timeout()
        async with aiohttp.ClientSession(timeout=timeout) as session:
            file_ids = await _upload_values(
                client,
                session,
                images[:1] if mode == MODE_TRANSITION else images,
                progress=ctx.progress,
            )
            tail_file_ids = await _upload_values(
                client,
                session,
                images[1:2] if mode == MODE_TRANSITION else [],
                progress=ctx.progress,
            )
            video_urls = await _upload_values(
                client, session, videos, progress=ctx.progress
            )
            audio_urls = await _upload_values(
                client, session, audio, progress=ctx.progress
            )
            request = _build_payload(
                prompt=prompt,
                model=self.model,
                mode=mode,
                aspect_ratio=str(
                    ctx.options.get("aspect_ratio")
                    or self.spec.get("default_aspect_ratio")
                    or ""
                ),
                resolution=str(
                    ctx.options.get("resolution")
                    or self.spec.get("default_resolution")
                    or ""
                ),
                duration_s=_coerce_duration(
                    ctx.options.get("duration_s"),
                    int((self.spec.get("duration") or {}).get("default") or 5),
                ),
                file_ids=file_ids,
                tail_file_ids=tail_file_ids,
                video_urls=video_urls,
                audio_urls=audio_urls,
            )
            payload = _build_batch_payload(request, batch_size)
            report_progress(ctx.progress, 0, 1, "Submitting videos to Ignis")
            task = await client.wait(
                session,
                await client.submit(session, payload),
                progress=ctx.progress,
            )
            result = task.get("result") or {}
            successful = _collect_media_items(result.get("successful") or [])
            if task.get("status") != "completed" or not successful:
                raise RuntimeError(
                    f"Ignis video generation failed: {_failure_message(task)}"
                )
            output_root = Path(folder_paths.get_output_directory()).resolve()
            run_dir = output_root / "ComfyTV" / "ignis" / uuid.uuid4().hex
            videos_out: list[dict] = []
            total = len(successful)
            for index, item in enumerate(successful, start=1):
                check_cancel()
                report_progress(
                    ctx.progress, index - 1, total,
                    f"Downloading video {index}/{total}",
                )
                filename = output_filename(item, f"video-{index}.mp4")
                destination = run_dir / f"{index:02d}-{filename}"
                await _download_video(session, item, destination)
                videos_out.append({
                    "index": str(index),
                    "label": f"#{index}",
                    "image_url": path_to_view_url(destination, "output"),
                    "provider": "ignis",
                    "model": self.model,
                })

            report_progress(ctx.progress, total, total, "Ignis videos ready")
            if batch_size == 1 and len(videos_out) == 1:
                return videos_out[0]["image_url"]
            return json.dumps({
                "images": videos_out,
                "meta": {
                    "provider": "ignis",
                    "model": self.model,
                    "request_count": batch_size,
                    "result_count": len(videos_out),
                    "failed_count": len(result.get("failed") or []),
                },
            })


def ignis_video_runners() -> list[IgnisVideoRunner]:
    return [IgnisVideoRunner(model) for model in IGNIS_VIDEO_SPECS]


def virtual_workflow_config(kind: str, label: str) -> dict | None:
    if kind != "video":
        return None
    for runner in ignis_video_runners():
        if runner.label == label:
            return runner.workflow_config()
    return None
