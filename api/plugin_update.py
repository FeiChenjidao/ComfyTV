"""Check / apply ComfyTV plugin updates from its own git remote."""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

from aiohttp import web

from ._common import routes
from .capabilities import VERSION

_log = logging.getLogger(__name__)
_GIT_TIMEOUT_S = 60
_VERSION_RE = re.compile(
    r'^\s*version\s*=\s*["\']([^"\']+)["\']',
    re.MULTILINE,
)


def _plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _git_bin() -> Optional[str]:
    return shutil.which("git")


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    git = _git_bin()
    if not git:
        raise RuntimeError("git executable not found on PATH")
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GCM_INTERACTIVE"] = "never"
    return subprocess.run(
        [git, *args],
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=_GIT_TIMEOUT_S,
        env=env,
    )


def _clean_remote_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    parts = urlsplit(text)
    if not parts.scheme or not parts.netloc:
        return text
    # Strip credentials from https remotes before returning to the UI.
    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def _parse_version(text: str) -> str:
    m = _VERSION_RE.search(text or "")
    return m.group(1) if m else ""


def _empty_payload(**extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": False,
        "is_repo": False,
        "has_git": bool(_git_bin()),
        "update_available": False,
        "local_version": VERSION,
        "remote_version": "",
        "local_sha": "",
        "remote_sha": "",
        "behind": 0,
        "ahead": 0,
        "dirty": False,
        "branch": "",
        "remote": "",
        "remote_url": "",
        "restart_required": False,
        "error": "",
        "error_code": "",
    }
    payload.update(extra)
    return payload


def check_plugin_update(*, fetch: bool = True, root: Optional[Path] = None) -> dict[str, Any]:
    root = root or _plugin_root()
    payload = _empty_payload(ok=True)
    try:
        local_text = (root / "pyproject.toml").read_text(encoding="utf-8")
        local_ver = _parse_version(local_text)
        if local_ver:
            payload["local_version"] = local_ver
    except OSError:
        pass
    if not _git_bin():
        payload["ok"] = False
        payload["error"] = "git executable not found"
        payload["error_code"] = "no_git"
        return payload

    if not (root / ".git").exists():
        payload["error"] = "ComfyTV is not a git checkout"
        payload["error_code"] = "not_repo"
        return payload

    payload["is_repo"] = True

    branch_p = _run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if branch_p.returncode != 0:
        payload["ok"] = False
        payload["error"] = (branch_p.stderr or branch_p.stdout or "rev-parse failed").strip()
        payload["error_code"] = "git_error"
        return payload
    branch = (branch_p.stdout or "").strip()
    payload["branch"] = branch

    local_sha_p = _run_git(root, "rev-parse", "HEAD")
    if local_sha_p.returncode == 0:
        payload["local_sha"] = (local_sha_p.stdout or "").strip()[:12]

    dirty_p = _run_git(root, "status", "--porcelain")
    payload["dirty"] = bool((dirty_p.stdout or "").strip()) if dirty_p.returncode == 0 else False

    remote_p = _run_git(root, "remote", "get-url", "origin")
    if remote_p.returncode != 0:
        payload["error"] = "no origin remote"
        payload["error_code"] = "no_remote"
        return payload
    payload["remote"] = "origin"
    payload["remote_url"] = _clean_remote_url(remote_p.stdout or "")

    if fetch:
        fetch_p = _run_git(root, "fetch", "--quiet", "origin")
        if fetch_p.returncode != 0:
            # Keep local comparison usable; surface fetch failure.
            payload["error"] = (fetch_p.stderr or fetch_p.stdout or "git fetch failed").strip()
            payload["error_code"] = "fetch_failed"

    # Prefer tracking branch; fall back to origin/<current> then origin/main.
    candidates = [f"origin/{branch}", "origin/main", "origin/master"]
    remote_ref = ""
    for cand in candidates:
        probe = _run_git(root, "rev-parse", "--verify", cand)
        if probe.returncode == 0:
            remote_ref = cand
            payload["remote_sha"] = (probe.stdout or "").strip()[:12]
            break
    if not remote_ref:
        if not payload["error"]:
            payload["error"] = "remote tip not found"
            payload["error_code"] = "no_remote_tip"
        return payload

    behind_p = _run_git(root, "rev-list", "--count", f"HEAD..{remote_ref}")
    ahead_p = _run_git(root, "rev-list", "--count", f"{remote_ref}..HEAD")
    if behind_p.returncode == 0:
        try:
            payload["behind"] = int((behind_p.stdout or "0").strip() or "0")
        except ValueError:
            payload["behind"] = 0
    if ahead_p.returncode == 0:
        try:
            payload["ahead"] = int((ahead_p.stdout or "0").strip() or "0")
        except ValueError:
            payload["ahead"] = 0

    show_p = _run_git(root, "show", f"{remote_ref}:pyproject.toml")
    if show_p.returncode == 0:
        payload["remote_version"] = _parse_version(show_p.stdout or "") or payload["remote_version"]

    payload["update_available"] = payload["behind"] > 0
    if payload["update_available"]:
        payload["error"] = ""
        payload["error_code"] = ""
    return payload


def apply_plugin_update(*, root: Optional[Path] = None) -> dict[str, Any]:
    root = root or _plugin_root()
    status = check_plugin_update(fetch=True, root=root)
    if not status.get("ok"):
        return status
    if not status.get("is_repo"):
        return status
    if status.get("dirty"):
        status["ok"] = False
        status["error"] = "local changes present — commit or stash before updating"
        status["error_code"] = "dirty"
        return status
    if not status.get("update_available"):
        status["error"] = "already up to date"
        status["error_code"] = "up_to_date"
        return status

    branch = status.get("branch") or "main"
    pull_p = _run_git(root, "pull", "--ff-only", "origin", branch)
    if pull_p.returncode != 0:
        # Retry against main if current branch tip is missing on origin.
        if branch not in ("main", "master"):
            pull_p = _run_git(root, "pull", "--ff-only", "origin", "main")
    if pull_p.returncode != 0:
        status["ok"] = False
        status["error"] = (pull_p.stderr or pull_p.stdout or "git pull failed").strip()
        status["error_code"] = "pull_failed"
        return status

    refreshed = check_plugin_update(fetch=False, root=root)
    refreshed["ok"] = True
    refreshed["restart_required"] = True
    refreshed["update_available"] = refreshed.get("behind", 0) > 0
    refreshed["error"] = ""
    refreshed["error_code"] = ""
    return refreshed


@routes.get("/comfytv/plugin/update")
async def get_plugin_update(request: web.Request) -> web.Response:
    fetch = request.rel_url.query.get("fetch", "1") != "0"
    return web.json_response(check_plugin_update(fetch=fetch))


@routes.post("/comfytv/plugin/update")
async def post_plugin_update(request: web.Request) -> web.Response:
    return web.json_response(apply_plugin_update())
