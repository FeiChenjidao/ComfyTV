from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import quote, urlparse

import aiohttp

from ._media_paths import view_url_to_path


DEFAULT_BASE_URL = "https://ignis-cli.funplus-marketing.ai"
MEDIA_CDN_BASE = "https://cdn-asia.funplus-marketing.ai/ultra"
CLIENT_VERSION = "0.12.4"
WAIT_TIMEOUT_S = 20 * 60
TERMINAL_STATUSES = {"completed", "failed"}

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
            "Ignis Token is not configured. Open ComfyTV Settings > "
            "Ignis image and video generation, then save your Token."
        )
    return (base_url or DEFAULT_BASE_URL).rstrip("/"), token


def has_ignis_token() -> bool:
    try:
        load_ignis_config()
    except RuntimeError:
        return False
    return True


def check_cancel() -> None:
    try:
        import comfy.model_management

        comfy.model_management.throw_exception_if_processing_interrupted()
    except ImportError:
        return


def report_progress(progress, value: int, total: int, text: str) -> None:
    if progress:
        progress(value, total, text)


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


class IgnisClient:
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
        check_cancel()
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
        check_cancel()
        async with session.post(
            f"{self.base_url}/api/cli/imagine",
            headers={**self._headers(), "Content-Type": "application/json"},
            json=payload,
        ) as response:
            return await _read_json_response(response)

    async def get_task(self, session: aiohttp.ClientSession, task_id: str) -> dict:
        check_cancel()
        async with session.get(
            f"{self.base_url}/api/cli/imagine/{quote(task_id, safe='')}",
            headers=self._headers(),
        ) as response:
            return await _read_json_response(response)

    async def wait(self, session: aiohttp.ClientSession, task: dict, progress=None) -> dict:
        started = asyncio.get_running_loop().time()
        current = task
        polls = 0
        while str(current.get("status") or "") not in TERMINAL_STATUSES:
            check_cancel()
            task_id = str(current.get("task_id") or "")
            if not task_id:
                raise RuntimeError("Ignis task response did not include task_id.")
            if asyncio.get_running_loop().time() - started >= WAIT_TIMEOUT_S:
                raise RuntimeError(
                    f"Ignis task {task_id} timed out after 20 minutes."
                )
            polls += 1
            report_progress(progress, polls, polls + 1, "Ignis is generating")
            delay_ms = max(
                500, min(int(current.get("poll_interval_ms") or 2000), 30000)
            )
            await asyncio.sleep(delay_ms / 1000)
            current = await self.get_task(session, task_id)
        return current


def media_url(item: dict, *, media_label: str = "media") -> str:
    url = str(item.get("url") or "").strip()
    if url:
        return url
    file_id = str(item.get("file_id") or "").strip()
    if not file_id:
        raise RuntimeError(
            f"Ignis completed without a downloadable {media_label} file."
        )
    encoded = "/".join(quote(part, safe="") for part in file_id.split("/"))
    return f"{MEDIA_CDN_BASE}/{encoded}"


def output_filename(item: dict, default_name: str) -> str:
    file_id = str(item.get("file_id") or "").replace("\\", "/")
    candidate = file_id.rsplit("/", 1)[-1] if file_id else ""
    if not candidate:
        candidate = Path(urlparse(str(item.get("url") or "")).path).name
    name = _SAFE_FILENAME_RE.sub("_", candidate).strip("._")
    return name or default_name


async def download_media(
    session: aiohttp.ClientSession,
    item: dict,
    destination: Path,
    *,
    media_label: str,
) -> None:
    check_cancel()
    async with session.get(media_url(item, media_label=media_label)) as response:
        if response.status >= 400:
            raise RuntimeError(
                f"Ignis {media_label} download failed ({response.status})."
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as handle:
            async for chunk in response.content.iter_chunked(1024 * 1024):
                check_cancel()
                handle.write(chunk)


def failure_message(task: dict) -> str:
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


def values(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        raw = value.values()
    elif isinstance(value, (list, tuple)):
        raw = value
    else:
        raw = [value]
    return [str(item).strip() for item in raw if str(item or "").strip()]


async def upload_values(
    client: IgnisClient,
    session: aiohttp.ClientSession,
    media_values: list[str],
    progress=None,
) -> list[str]:
    out: list[str] = []
    total = max(1, len(media_values))
    for index, value in enumerate(media_values):
        check_cancel()
        report_progress(progress, index, total, f"Uploading reference {index + 1}/{total}")
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


def client_timeout() -> aiohttp.ClientTimeout:
    return aiohttp.ClientTimeout(
        total=None, connect=30, sock_connect=30, sock_read=120
    )
