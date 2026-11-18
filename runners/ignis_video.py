from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from pathlib import Path
from urllib.parse import quote

import aiohttp
import folder_paths

from ._media_paths import path_to_view_url, view_url_to_path
from .base import Runner, RunnerContext


DEFAULT_BASE_URL = "https://ignis-cli.funplus-marketing.ai"
MEDIA_CDN_BASE = "https://cdn-asia.funplus-marketing.ai/ultra"
CLIENT_VERSION = "0.12.4"
WAIT_TIMEOUT_S = 20 * 60
TERMINAL_STATUSES = {"completed", "failed"}

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

_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig").strip()
    except OSError:
        return ""


def load_ignis_config() -> tuple[str, str]:
    base_url = (
        os.environ.get("IGNIS_BASE_URL", "").strip()
        or os.environ.get("MAI_BASE_URL", "").strip()
    )
    token = (
        os.environ.get("IGNIS_CLI_TOKEN", "").strip()
        or os.environ.get("MAI_CLI_TOKEN", "").strip()
    )
    secrets_dir = _plugin_root() / "secrets"
    base_url = base_url or _read_text(secrets_dir / "ignis-base-url")
    token = token or _read_text(secrets_dir / "ignis-token")

    if not base_url or not token:
        try:
            config = json.loads(
                (Path.home() / ".ignis" / "config.json").read_text(
                    encoding="utf-8-sig"
                )
            )
        except (OSError, ValueError, TypeError):
            config = {}
        base_url = base_url or str(
            config.get("baseUrl") or config.get("base_url") or ""
        ).strip()
        token = token or str(
            config.get("cliToken") or config.get("cli_token") or ""
        ).strip()

    if not token:
        raise RuntimeError(
            "Ignis token is not configured. Set IGNIS_CLI_TOKEN or save it to "
            "ComfyTV/secrets/ignis-token."
        )
    return (base_url or DEFAULT_BASE_URL).rstrip("/"), token


async def _read_json_response(response: aiohttp.ClientResponse) -> dict:
    text = await response.text()
    try:
        payload = json.loads(text) if text else {}
    except ValueError:
        payload = {"message": text}
    if response.status >= 400:
        message = response.reason
        if isinstance(payload, dict):
            message = payload.get("message") or payload.get("detail") or message
        raise RuntimeError(f"Ignis request failed ({response.status}): {message}")
    if not isinstance(payload, dict):
        raise RuntimeError("Ignis returned an invalid JSON response.")
    return payload


class _IgnisClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "X-Ignis-CLI-Version": CLIENT_VERSION,
        }

    async def upload(self, session: aiohttp.ClientSession, path: Path) -> dict:
        form = aiohttp.FormData()
        with path.open("rb") as handle:
            form.add_field(
                "file",
                handle,
                filename=path.name,
                content_type="application/octet-stream",
            )
            async with session.post(
                f"{self.base_url}/api/cli/files",
                headers=self._headers(),
                data=form,
            ) as response:
                return await _read_json_response(response)

    async def submit(self, session: aiohttp.ClientSession, payload: dict) -> dict:
        async with session.post(
            f"{self.base_url}/api/cli/imagine",
            headers={**self._headers(), "Content-Type": "application/json"},
            json=payload,
        ) as response:
            return await _read_json_response(response)

    async def get_task(self, session: aiohttp.ClientSession, task_id: str) -> dict:
        async with session.get(
            f"{self.base_url}/api/cli/imagine/{quote(task_id, safe='')}",
            headers=self._headers(),
        ) as response:
            return await _read_json_response(response)

    async def wait(self, session: aiohttp.ClientSession, task: dict) -> dict:
        started = asyncio.get_running_loop().time()
        current = task
        while str(current.get("status") or "") not in TERMINAL_STATUSES:
            task_id = str(current.get("task_id") or "")
            if not task_id:
                raise RuntimeError("Ignis task response did not include task_id.")
            if asyncio.get_running_loop().time() - started >= WAIT_TIMEOUT_S:
                raise RuntimeError(
                    f"Ignis task {task_id} timed out after 20 minutes."
                )
            delay_ms = max(
                500, min(int(current.get("poll_interval_ms") or 2000), 30000)
            )
            await asyncio.sleep(delay_ms / 1000)
            current = await self.get_task(session, task_id)
        return current


def _media_url(item: dict) -> str:
    url = str(item.get("url") or "").strip()
    if url:
        return url
    file_id = str(item.get("file_id") or "").strip()
    if not file_id:
        raise RuntimeError("Ignis completed without a downloadable video file.")
    encoded = "/".join(quote(part, safe="") for part in file_id.split("/"))
    return f"{MEDIA_CDN_BASE}/{encoded}"


def _output_filename(item: dict) -> str:
    file_id = str(item.get("file_id") or "video.mp4").replace("\\", "/")
    name = _SAFE_FILENAME_RE.sub("_", file_id.rsplit("/", 1)[-1]).strip("._")
    return name or "video.mp4"


async def _download_video(
    session: aiohttp.ClientSession, item: dict, destination: Path
) -> None:
    async with session.get(_media_url(item)) as response:
        if response.status >= 400:
            raise RuntimeError(f"Ignis video download failed ({response.status}).")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as handle:
            async for chunk in response.content.iter_chunked(1024 * 1024):
                handle.write(chunk)


def _failure_message(task: dict) -> str:
    failed = (task.get("result") or {}).get("failed", [])
    if failed:
        first = failed[0] if isinstance(failed[0], dict) else {}
        return str(
            first.get("message")
            or first.get("error")
            or first.get("status")
            or "generation failed"
        )
    error = task.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error.get("detail") or error)
    return str(error or "generation failed")


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


def _values(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        raw = value.values()
    elif isinstance(value, (list, tuple)):
        raw = value
    else:
        raw = [value]
    return [str(item).strip() for item in raw if str(item or "").strip()]


async def _upload_values(
    client: _IgnisClient,
    session: aiohttp.ClientSession,
    values: list[str],
) -> list[str]:
    out: list[str] = []
    for value in values:
        if value.startswith(("http://", "https://")):
            raise RuntimeError(
                "Remote reference URLs are not accepted. Load the media into ComfyTV first."
            )
        path = view_url_to_path(value)
        if path is None:
            if value.startswith(("/view?", "/api/view?")):
                raise RuntimeError(f"Reference media does not exist: {value}")
            out.append(value)
            continue
        upload = await client.upload(session, path)
        file_id = str(upload.get("file_id") or "").strip()
        if not file_id:
            raise RuntimeError("Ignis upload response did not include file_id.")
        out.append(file_id)
    return out


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
        options = {"mode": True}
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
        timeout = aiohttp.ClientTimeout(
            total=None, connect=30, sock_connect=30, sock_read=120
        )
        async with aiohttp.ClientSession(timeout=timeout) as session:
            file_ids = await _upload_values(
                client,
                session,
                images[:1] if mode == MODE_TRANSITION else images,
            )
            tail_file_ids = await _upload_values(
                client,
                session,
                images[1:2] if mode == MODE_TRANSITION else [],
            )
            video_urls = await _upload_values(client, session, videos)
            audio_urls = await _upload_values(client, session, audio)
            payload = _build_payload(
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
            task = await client.wait(session, await client.submit(session, payload))
            successful = (task.get("result") or {}).get("successful", [])
            if task.get("status") != "completed" or not successful:
                raise RuntimeError(
                    f"Ignis video generation failed: {_failure_message(task)}"
                )
            item = successful[0]
            if not isinstance(item, dict):
                raise RuntimeError("Ignis returned an invalid video result.")
            output_root = Path(folder_paths.get_output_directory()).resolve()
            destination = (
                output_root
                / "ComfyTV"
                / "ignis"
                / uuid.uuid4().hex
                / _output_filename(item)
            )
            await _download_video(session, item, destination)
            return path_to_view_url(destination, "output")


def ignis_video_runners() -> list[IgnisVideoRunner]:
    return [IgnisVideoRunner(model) for model in IGNIS_VIDEO_SPECS]


def virtual_workflow_config(kind: str, label: str) -> dict | None:
    if kind != "video":
        return None
    for runner in ignis_video_runners():
        if runner.label == label:
            return runner.workflow_config()
    return None
