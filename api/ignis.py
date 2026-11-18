"""Local Ignis credential status and configuration endpoints."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from aiohttp import web

from ._common import routes


def _plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _token_path() -> Path:
    return _plugin_root() / "secrets" / "ignis-token"


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
        import json
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
