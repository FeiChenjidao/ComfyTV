"""Local Ignis credential status and configuration endpoints."""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp
from aiohttp import web

from ._common import routes, broadcast_workflow_event


CONFIG_HOST = "ignis-cli-config.funplus-marketing.ai"
CONFIG_PATH_RE = re.compile(r"^/config/[A-Za-z0-9_-]+\.json$")
CONFIG_URL_RE = re.compile(r"https://[^\s<>'\"`]+", re.IGNORECASE)
MAX_CONFIG_BYTES = 64 * 1024
_log = logging.getLogger(__name__)


def _plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _token_path() -> Path:
    return _plugin_root() / "secrets" / "ignis-token"


def _base_url_path() -> Path:
    return _plugin_root() / "secrets" / "ignis-base-url"


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig").strip()
    except OSError:
        return ""


def _configured_token() -> str:
    token = os.environ.get("IGNIS_CLI_TOKEN", "").strip()
    if token:
        return token
    token = _read_text(_token_path())
    if token:
        return token
    token = os.environ.get("MAI_CLI_TOKEN", "").strip()
    if token:
        return token
    config = Path.home() / ".ignis" / "config.json"
    try:
        data = json.loads(config.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, TypeError):
        data = {}
    return str(data.get("cliToken") or data.get("cli_token") or "").strip()


def _hint(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}…{token[-4:]}"


def token_status(*, saved: bool = False, error: str = "") -> dict[str, Any]:
    token = _configured_token()
    return {
        "ok": not error,
        "configured": bool(token),
        "hint": _hint(token),
        "saved": saved,
        "error": error,
    }


def save_token(token: str) -> dict[str, Any]:
    value = str(token or "").strip()
    if not value:
        return token_status(error="Ignis Token 不能为空")
    path = _token_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value + "\n", encoding="utf-8")
    except OSError as exc:
        return token_status(error=f"无法保存 Ignis Token：{exc}")
    try:
        _refresh_ignis_workflows()
    except Exception:
        _log.exception("[ComfyTV/Ignis] workflow refresh failed after token save")
    return token_status(saved=True)


def _refresh_ignis_workflows() -> None:
    from ..runners import refresh_registry
    from ..runners.ignis_image import ignis_image_runners
    from ..runners.ignis_video import ignis_video_runners

    registry = refresh_registry()
    added = [
        {"kind": kind, "label": runner.label}
        for runner in [*ignis_image_runners(), *ignis_video_runners()]
        for kind in runner.kinds
        if registry.by_label(runner.label, kind) is not None
    ]
    if added:
        broadcast_workflow_event("rescan", {"added": added})


def _config_url_from_text(text: str) -> str:
    normalized = str(text or "").replace("\\:", ":").replace("\\/", "/")
    for match in CONFIG_URL_RE.finditer(normalized):
        candidate = match.group(0).rstrip(".,;:!?)]}\\")
        parsed = urlparse(candidate)
        try:
            port = parsed.port
        except ValueError:
            continue
        if (
            parsed.scheme == "https"
            and parsed.hostname == CONFIG_HOST
            and port in (None, 443)
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
            and CONFIG_PATH_RE.fullmatch(parsed.path)
        ):
            return candidate
    return ""


def _config_payload_from_text(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw.startswith("{"):
        return None
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def _config_token(payload: dict[str, Any]) -> str:
    return str(
        payload.get("cliToken")
        or payload.get("cli_token")
        or payload.get("token")
        or ""
    ).strip()


def _config_base_url(payload: dict[str, Any]) -> str:
    value = str(payload.get("baseUrl") or payload.get("base_url") or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    try:
        port = parsed.port
    except ValueError:
        return ""
    hostname = str(parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or not hostname.endswith(".funplus-marketing.ai")
        or port not in (None, 443)
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return ""
    return value.rstrip("/")


async def _fetch_config_payload(url: str) -> dict[str, Any]:
    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            url,
            headers={"Accept": "application/json"},
            allow_redirects=False,
        ) as response:
            if response.status != 200:
                raise RuntimeError(f"配置链接请求失败（HTTP {response.status}）")
            raw = await response.content.read(MAX_CONFIG_BYTES + 1)
    if len(raw) > MAX_CONFIG_BYTES:
        raise RuntimeError("配置文件过大")
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, TypeError) as exc:
        raise RuntimeError("配置链接返回的不是有效 JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("配置链接返回的数据格式不正确")
    return payload


async def import_config_text(text: str, *, fetch_config=None) -> dict[str, Any]:
    raw = str(text or "").strip()
    if not raw:
        return token_status(error="配置链接或安装文本不能为空")
    payload = _config_payload_from_text(raw)
    if payload is None:
        url = _config_url_from_text(raw)
        if not url:
            return token_status(error="没有找到有效的 Ignis config 链接")
        try:
            payload = await (fetch_config or _fetch_config_payload)(url)
        except Exception as exc:
            return token_status(error=f"无法读取 Ignis 配置：{exc}")
    token = _config_token(payload)
    if not token:
        return token_status(error="Ignis 配置中没有 cliToken")
    base_url = _config_base_url(payload)
    if payload.get("baseUrl") and not base_url:
        return token_status(error="Ignis 配置中的 baseUrl 不安全或格式不正确")
    result = save_token(token)
    if not result.get("ok") or not base_url:
        return result
    try:
        path = _base_url_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(base_url + "\n", encoding="utf-8")
    except OSError as exc:
        return token_status(error=f"无法保存 Ignis 服务地址：{exc}")
    return token_status(saved=True)


@routes.get("/comfytv/ignis/token")
async def ignis_token_status(request: web.Request) -> web.Response:
    return web.json_response(token_status())


@routes.put("/comfytv/ignis/token")
async def ignis_token_set(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}
    return web.json_response(save_token((body or {}).get("token")))


@routes.put("/comfytv/ignis/config")
async def ignis_config_set(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}
    return web.json_response(await import_config_text((body or {}).get("text")))
