from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

import aiohttp
import folder_paths

from ._ignis import (
    IgnisClient,
    check_cancel,
    client_timeout,
    download_media,
    failure_message,
    load_ignis_config,
    output_filename,
    report_progress,
    upload_values,
    values,
)
from ._media_paths import path_to_view_url
from .base import Runner, RunnerContext


_log = logging.getLogger(__name__)

COMMON_RATIOS = [
    "auto", "21:9", "16:9", "3:2", "4:3", "5:4",
    "1:1", "4:5", "3:4", "2:3", "9:16",
]

BACKGROUND_OPTIONS = ["auto", "transparent", "opaque"]

BACKGROUND_PROMPTS = {
    "transparent": (
        "Render the subject on a fully transparent background with clean alpha "
        "edges. Return a PNG with an alpha channel and do not add a solid background."
    ),
    "opaque": (
        "Render with a fully opaque background. Do not use transparency or an "
        "alpha channel."
    ),
}

IGNIS_IMAGE_SPECS = {
    "nano-banana": {
        "label": "Ignis Nano Banana Pro",
        "description": "Ignis Nano Banana Pro remote image generation and editing.",
        "aspect_ratios": COMMON_RATIOS,
        "default_aspect_ratio": "auto",
        "supports_edit": True,
        "max_images": 12,
    },
    "seedream": {
        "label": "Ignis Seedream 5 Pro",
        "description": "Ignis Seedream 5 Pro remote image generation and editing.",
        "aspect_ratios": ["auto", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
        "default_aspect_ratio": "auto",
        "supports_edit": True,
        "max_images": 12,
    },
    "nano-banana-2": {
        "label": "Ignis Nano Banana 2.1",
        "description": "Ignis Nano Banana 2.1 remote image generation and editing.",
        "aspect_ratios": COMMON_RATIOS,
        "default_aspect_ratio": "auto",
        "supports_edit": True,
        "max_images": 12,
    },
    "midjourney": {
        "label": "Ignis Midjourney",
        "description": "Ignis Midjourney remote image generation.",
        "aspect_ratios": ["16:9", "9:16", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3"],
        "default_aspect_ratio": "1:1",
        "supports_edit": False,
        "max_images": 0,
    },
    "dreamina": {
        "label": "Ignis Dreamina V3.1",
        "description": "Ignis Dreamina V3.1 remote image generation.",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "default_aspect_ratio": "1:1",
        "supports_edit": False,
        "max_images": 0,
    },
    "z-image": {
        "label": "Ignis Z-image",
        "description": "Ignis Z-image remote image generation.",
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "default_aspect_ratio": "1:1",
        "supports_edit": False,
        "max_images": 0,
    },
    "gpt-image": {
        "label": "Ignis GPT Image 2.6",
        "description": "Ignis GPT Image 2.6 remote image generation and editing.",
        "aspect_ratios": ["1:1", "2:3", "3:2", "3:4", "4:3", "16:9", "9:16"],
        "default_aspect_ratio": "1:1",
        "supports_edit": True,
        "max_images": 12,
    },
    "ideogram": {
        "label": "Ignis Ideogram 4.5",
        "description": "Ignis Ideogram 4.5 remote image generation and editing.",
        "aspect_ratios": COMMON_RATIOS,
        "default_aspect_ratio": "auto",
        "supports_edit": True,
        "max_images": 5,
    },
}


def _widget(name: str, type_: str, props: dict, current) -> dict:
    return {
        "node_id": "ignis",
        "node_title": "Ignis",
        "node_type": "IgnisImageRunner",
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


def _batch_size(value) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = 1
    if not 1 <= count <= 8:
        raise RuntimeError("Ignis image batch size must be between 1 and 8.")
    return count


def _build_request(
    *,
    model: str,
    prompt: str,
    aspect_ratio: str,
    background: str = "auto",
    file_ids: list[str],
) -> dict:
    spec = IGNIS_IMAGE_SPECS[model]
    max_images = int(spec["max_images"])
    if file_ids and not spec["supports_edit"]:
        raise RuntimeError(
            f"{spec['label']} only supports text-to-image and does not accept reference images."
        )
    if len(file_ids) > max_images:
        raise RuntimeError(
            f"{spec['label']} supports at most {max_images} reference images."
        )
    ratio = str(aspect_ratio or spec["default_aspect_ratio"])
    if ratio not in spec["aspect_ratios"]:
        ratio = str(spec["default_aspect_ratio"])
    background_mode = str(background or "auto").strip().lower()
    if background_mode not in BACKGROUND_OPTIONS:
        background_mode = "auto"
    background_prompt = BACKGROUND_PROMPTS.get(background_mode)
    if background_prompt:
        prompt = f"{prompt.rstrip()}\n\n{background_prompt}"
    request = {
        "model": model,
        "prompt": prompt,
        "aspect_ratio": ratio,
    }
    if file_ids:
        request["file_ids"] = list(file_ids)
    return request


def _build_payload(request: dict, batch_size: int) -> dict:
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
    for key in ("output", "outputs", "image", "images", "result", "results", "files"):
        if key in value:
            out.extend(_collect_media_items(value[key]))
    return out


class IgnisImageRunner(Runner):
    def __init__(self, model: str):
        spec = IGNIS_IMAGE_SPECS[model]
        super().__init__(f"ignis-image/{model}", str(spec["label"]), {"image"})
        self.model = model
        self.spec = spec

    def workflow_config(self) -> dict:
        widgets = [
            _widget(
                "aspect_ratio",
                "COMBO",
                {"values": list(self.spec["aspect_ratios"])},
                self.spec["default_aspect_ratio"],
            ),
            _widget(
                "batch_size",
                "INT",
                {"min": 1, "max": 8, "step": 1},
                1,
            ),
            _widget(
                "background",
                "COMBO",
                {"values": list(BACKGROUND_OPTIONS)},
                "auto",
            ),
        ]
        return {
            "id": -100 - list(IGNIS_IMAGE_SPECS).index(self.model),
            "kind": "image",
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
                "billing": "ignis_credits",
                "model": self.model,
                "bound_only_params": True,
                "background_control": "prompt_guided",
            },
        }

    def workflow_usage(self) -> dict:
        max_images = int(self.spec["max_images"])
        media_keys = ("image", "video", "audio", "text", "model")
        return {
            "uses": {
                "image": max_images > 0,
                "video": False,
                "audio": False,
                "text": True,
                "model": False,
            },
            "requires": {key: False for key in media_keys},
            "required_slots": {key: [] for key in media_keys},
            "max_inputs": {
                "image": max_images,
                "video": 0,
                "audio": 0,
                "text": None,
                "model": 0,
            },
            "uses_computed": {"width": False, "height": False, "length": False},
            "uses_options": {
                "aspect_ratio": True,
                "batch_size": True,
                "background": True,
            },
            "uses_mask": False,
            "prompt_required": True,
        }

    async def invoke(self, ctx: RunnerContext):
        prompt = str(ctx.main_prompt or "").strip()
        if not prompt:
            raise RuntimeError("Ignis image generation requires a prompt.")
        if str(ctx.options.get("mask_data") or "").strip():
            raise RuntimeError(
                "Ignis image workflows do not support the Image Stage mask input."
            )

        image_values = values(ctx.upstream.get("images"))
        max_images = int(self.spec["max_images"])
        if image_values and not self.spec["supports_edit"]:
            raise RuntimeError(
                f"{self.label} only supports text-to-image. Remove the connected reference images."
            )
        if len(image_values) > max_images:
            raise RuntimeError(
                f"{self.label} supports at most {max_images} reference images."
            )
        batch_size = _batch_size(ctx.options.get("batch_size"))

        base_url, token = load_ignis_config()
        client = IgnisClient(base_url, token)
        async with aiohttp.ClientSession(timeout=client_timeout()) as session:
            file_ids = await upload_values(
                client,
                session,
                image_values,
                progress=ctx.progress,
            )
            request = _build_request(
                model=self.model,
                prompt=prompt,
                aspect_ratio=str(ctx.options.get("aspect_ratio") or ""),
                background=str(ctx.options.get("background") or "auto"),
                file_ids=file_ids,
            )
            payload = _build_payload(request, batch_size)
            report_progress(ctx.progress, 0, 1, "Submitting to Ignis")
            task = await client.wait(
                session,
                await client.submit(session, payload),
                progress=ctx.progress,
            )
            result = task.get("result") or {}
            successful = _collect_media_items(result.get("successful") or [])
            failed = list(result.get("failed") or [])
            if not successful:
                raise RuntimeError(
                    f"Ignis image generation failed: {failure_message(task)}"
                )

            run_dir = (
                Path(folder_paths.get_output_directory()).resolve()
                / "ComfyTV"
                / "ignis"
                / uuid.uuid4().hex
            )
            images: list[dict] = []
            download_errors: list[str] = []
            total = len(successful)
            for index, item in enumerate(successful, start=1):
                check_cancel()
                report_progress(
                    ctx.progress, index - 1, total, f"Downloading image {index}/{total}"
                )
                filename = output_filename(item, f"image-{index}.png")
                destination = run_dir / f"{index:02d}-{filename}"
                try:
                    await download_media(
                        session,
                        item,
                        destination,
                        media_label="image",
                    )
                except Exception as exc:
                    download_errors.append(str(exc))
                    _log.warning(
                        "[ComfyTV/Ignis] failed to download image %d: %s",
                        index,
                        exc,
                    )
                    continue
                images.append({
                    "index": str(len(images) + 1),
                    "label": f"#{len(images) + 1}",
                    "image_url": path_to_view_url(destination, "output"),
                    "provider": "ignis",
                    "model": self.model,
                })

            if not images:
                detail = download_errors[0] if download_errors else failure_message(task)
                raise RuntimeError(f"Ignis returned images but none could be downloaded: {detail}")
            failed_count = len(failed) + len(download_errors)
            if failed_count:
                _log.warning(
                    "[ComfyTV/Ignis] %s completed with %d successful images and %d failures",
                    self.model,
                    len(images),
                    failed_count,
                )
            report_progress(ctx.progress, total, total, "Ignis images ready")
            return json.dumps({
                "images": images,
                "meta": {
                    "provider": "ignis",
                    "model": self.model,
                    "request_count": batch_size,
                    "result_count": len(images),
                    "failed_count": failed_count,
                },
            })


def ignis_image_runners() -> list[IgnisImageRunner]:
    return [IgnisImageRunner(model) for model in IGNIS_IMAGE_SPECS]
