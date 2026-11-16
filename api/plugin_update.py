"""Check / apply ComfyTV plugin updates from its own git remote."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

from aiohttp import web

from ._common import routes
from .capabilities import VERSION

_log = logging.getLogger(__name__)
_GIT_TIMEOUT_S = 60
_UPDATE_LOCK = threading.Lock()
_UPDATE_STATE = "comfytv-update-state.json"
_UPDATE_BACKUPS = "comfytv-update-backups"
_DEPENDENCY_FILES = {
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}
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
    command = [git, *args]
    try:
        return subprocess.run(
            command,
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_GIT_TIMEOUT_S,
            env=env,
        )
    except subprocess.TimeoutExpired as error:
        return subprocess.CompletedProcess(
            command,
            124,
            stdout=str(error.stdout or ""),
            stderr=f"git command timed out after {_GIT_TIMEOUT_S}s",
        )
    except OSError as error:
        return subprocess.CompletedProcess(command, 127, stdout="", stderr=str(error))


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


def _git_dir(root: Path) -> Optional[Path]:
    result = _run_git(root, "rev-parse", "--git-dir")
    if result.returncode != 0:
        return None
    path = Path((result.stdout or "").strip())
    if not path.is_absolute():
        path = root / path
    try:
        return path.resolve()
    except OSError:
        return path


def _state_path(root: Path) -> Optional[Path]:
    git_dir = _git_dir(root)
    return git_dir / _UPDATE_STATE if git_dir else None


def _read_state(root: Path) -> dict[str, Any]:
    path = _state_path(root)
    if not path or not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_state(root: Path, state: dict[str, Any]) -> None:
    path = _state_path(root)
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def _commit_exists(root: Path, sha: str) -> bool:
    if not sha:
        return False
    return _run_git(root, "cat-file", "-e", f"{sha}^{{commit}}").returncode == 0


def _attach_recovery_state(payload: dict[str, Any], root: Path) -> None:
    state = _read_state(root)
    previous_sha = str(state.get("previous_sha") or "")
    available = bool(state.get("rollback_available")) and _commit_exists(root, previous_sha)
    payload["rollback_available"] = available
    payload["rollback_sha"] = previous_sha[:12] if available else ""
    payload["rollback_version"] = str(state.get("previous_version") or "") if available else ""
    payload["backup_path"] = str(state.get("backup_path") or "")
    payload["local_backups"] = list(state.get("local_backups") or [])
    payload["dependency_files_changed"] = list(state.get("dependency_files_changed") or [])


def _tree_paths(root: Path, ref: str) -> set[str]:
    result = _run_git(root, "-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", ref)
    if result.returncode != 0:
        return set()
    return {
        line.strip().replace("\\", "/")
        for line in (result.stdout or "").splitlines()
        if line.strip()
    }


def _unique_backup_path(path: Path) -> Path:
    base = Path(str(path) + ".local-backup")
    if not base.exists():
        return base
    for index in range(2, 100):
        candidate = Path(str(path) + f".local-backup-{index}")
        if not candidate.exists():
            return candidate
    return Path(str(path) + f".local-backup-{os.getpid()}")


def _backup_dir(root: Path, previous_sha: str) -> Optional[Path]:
    git_dir = _git_dir(root)
    if not git_dir:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = git_dir / _UPDATE_BACKUPS / f"{stamp}-{previous_sha[:12]}"
    path = base
    suffix = 1
    while path.exists():
        suffix += 1
        path = Path(f"{base}-{suffix}")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _prune_update_backups(root: Path, keep: int = 5) -> None:
    git_dir = _git_dir(root)
    if not git_dir:
        return
    backup_root = git_dir / _UPDATE_BACKUPS
    if not backup_root.is_dir():
        return
    backups = sorted(path for path in backup_root.iterdir() if path.is_dir())
    for old in backups[:-max(1, keep)]:
        try:
            shutil.rmtree(old)
            _run_git(root, "update-ref", "-d", f"refs/comfytv/update-backup/{old.name}")
        except OSError as error:
            _log.warning("could not prune update backup %s: %s", old, error)


def _copy_backup_file(root: Path, backup_dir: Optional[Path], rel: str, source: Path) -> None:
    if not backup_dir:
        return
    destination = backup_dir / "files" / Path(rel)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _prepare_worktree(
    root: Path,
    target_sha: str,
    backup_dir: Optional[Path],
    *,
    preserve_tracked_local_workflows: bool,
) -> tuple[dict[str, bytes], list[tuple[Path, Path]], list[str]]:
    """Protect files that a hard reset could otherwise destroy."""
    head_paths = _tree_paths(root, "HEAD")
    target_paths = _tree_paths(root, target_sha)
    merge_base_p = _run_git(root, "merge-base", "HEAD", target_sha)
    merge_base = (merge_base_p.stdout or "").strip() if merge_base_p.returncode == 0 else ""
    base_paths = _tree_paths(root, merge_base) if merge_base else set()
    local_workflows: dict[str, bytes] = {}
    moved: list[tuple[Path, Path]] = []
    local_backups: list[str] = []

    if preserve_tracked_local_workflows:
        for rel in sorted(head_paths - target_paths):
            if not rel.startswith("workflows/") or not rel.lower().endswith(".json"):
                continue
            source = root / rel
            if not source.is_file():
                continue
            try:
                local_workflows[rel] = source.read_bytes()
                _copy_backup_file(root, backup_dir, rel, source)
            except OSError as error:
                _log.warning("could not snapshot local workflow %s: %s", rel, error)

    collisions = set(target_paths - head_paths)
    collisions.update(
        rel
        for rel in (target_paths & head_paths) - base_paths
        if rel.startswith("workflows/") and rel.lower().endswith(".json")
    )
    for rel in sorted(collisions):
        source = root / rel
        if not source.is_file():
            continue
        destination = _unique_backup_path(source)
        try:
            _copy_backup_file(root, backup_dir, rel, source)
            source.rename(destination)
            moved.append((source, destination))
            local_backups.append(destination.relative_to(root).as_posix())
        except OSError as error:
            _restore_moved_files(moved)
            raise RuntimeError(f"could not protect local file {rel}: {error}") from error

    return local_workflows, moved, local_backups


def _restore_local_workflows(root: Path, workflows: dict[str, bytes]) -> None:
    for rel, data in workflows.items():
        path = root / rel
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as error:
            _log.warning("could not restore local workflow %s: %s", rel, error)


def _restore_moved_files(moved: list[tuple[Path, Path]]) -> None:
    for original, backup in moved:
        if original.exists() or not backup.exists():
            continue
        try:
            backup.rename(original)
        except OSError as error:
            _log.warning("could not restore protected file %s: %s", original, error)


def _write_dirty_patch(root: Path, backup_dir: Optional[Path]) -> str:
    if not backup_dir:
        return ""
    result = _run_git(root, "diff", "--binary", "HEAD", "--")
    if result.returncode != 0 or not result.stdout:
        return ""
    path = backup_dir / "tracked-changes.patch"
    path.write_text(result.stdout, encoding="utf-8")
    return str(path)


def _changed_dependency_files(root: Path, previous_sha: str, target_sha: str) -> list[str]:
    changed: list[str] = []
    for path in sorted(_DEPENDENCY_FILES):
        previous = _file_at(root, previous_sha, path)
        target = _file_at(root, target_sha, path)
        if path == "pyproject.toml":
            if _pyproject_dependencies(previous) != _pyproject_dependencies(target):
                changed.append(path)
        elif path == "package.json":
            if _package_dependencies(previous) != _package_dependencies(target):
                changed.append(path)
        elif previous != target:
            changed.append(path)
    return changed


def _file_at(root: Path, ref: str, path: str) -> str:
    result = _run_git(root, "show", f"{ref}:{path}")
    return (result.stdout or "") if result.returncode == 0 else ""


def _pyproject_dependencies(text: str) -> dict[str, Any]:
    if not text:
        return {}
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return {"raw": text}
    project = data.get("project") if isinstance(data.get("project"), dict) else {}
    tool = data.get("tool") if isinstance(data.get("tool"), dict) else {}
    poetry = tool.get("poetry") if isinstance(tool.get("poetry"), dict) else {}
    return {
        "dependencies": project.get("dependencies"),
        "optional-dependencies": project.get("optional-dependencies"),
        "poetry-dependencies": poetry.get("dependencies"),
        "poetry-groups": poetry.get("group"),
    }


def _package_dependencies(text: str) -> dict[str, Any]:
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}
    if not isinstance(data, dict):
        return {"raw": data}
    return {
        key: data.get(key)
        for key in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
    }


def _version_at(root: Path, ref: str) -> str:
    result = _run_git(root, "show", f"{ref}:pyproject.toml")
    return _parse_version(result.stdout or "") if result.returncode == 0 else ""


def _verify_reset(root: Path, target_sha: str) -> tuple[bool, str]:
    head = _run_git(root, "rev-parse", "HEAD")
    actual = (head.stdout or "").strip() if head.returncode == 0 else ""
    if head.returncode != 0 or actual != target_sha:
        return False, f"HEAD verification failed: expected {target_sha[:12]}, got {actual[:12] or '?'}"
    clean = _run_git(root, "diff", "--quiet", "HEAD", "--")
    if clean.returncode != 0:
        return False, "tracked files are not clean after update"
    return True, ""


def _resolve_remote_target(root: Path, branch: str) -> tuple[str, str]:
    candidates = [f"origin/{branch}", "origin/main", "origin/master"]
    for candidate in candidates:
        probe = _run_git(root, "rev-parse", "--verify", f"{candidate}^{{commit}}")
        if probe.returncode == 0:
            return candidate, (probe.stdout or "").strip()
    return "", ""


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
        "repair_available": False,
        "branch": "",
        "remote": "",
        "remote_url": "",
        "restart_required": False,
        "update_in_progress": False,
        "rollback_available": False,
        "rollback_sha": "",
        "rollback_version": "",
        "backup_path": "",
        "local_backups": [],
        "dependency_files_changed": [],
        "rolled_back": False,
        "error": "",
        "error_code": "",
    }
    payload.update(extra)
    return payload


def check_plugin_update(*, fetch: bool = True, root: Optional[Path] = None) -> dict[str, Any]:
    root = root or _plugin_root()
    payload = _empty_payload(ok=True)
    payload["update_in_progress"] = _UPDATE_LOCK.locked()
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
        payload["ok"] = False
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
    _attach_recovery_state(payload, root)

    dirty_p = _run_git(root, "status", "--porcelain", "--untracked-files=no")
    payload["dirty"] = bool((dirty_p.stdout or "").strip()) if dirty_p.returncode == 0 else False

    remote_p = _run_git(root, "remote", "get-url", "origin")
    if remote_p.returncode != 0:
        payload["ok"] = False
        payload["error"] = "no origin remote"
        payload["error_code"] = "no_remote"
        return payload
    payload["remote"] = "origin"
    payload["remote_url"] = _clean_remote_url(remote_p.stdout or "")

    if fetch:
        fetch_p = _run_git(root, "fetch", "--quiet", "origin")
        if fetch_p.returncode != 0:
            payload["ok"] = False
            payload["error"] = (fetch_p.stderr or fetch_p.stdout or "git fetch failed").strip()
            payload["error_code"] = "fetch_failed"
            return payload

    remote_ref, remote_sha = _resolve_remote_target(root, branch)
    payload["remote_sha"] = remote_sha[:12]
    if not remote_ref:
        payload["ok"] = False
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
    payload["repair_available"] = bool(payload["dirty"] or payload["ahead"] > 0)
    return payload


def apply_plugin_update(*, root: Optional[Path] = None) -> dict[str, Any]:
    """Force plugin files onto the remote tip.

    Always ``git reset --hard`` to origin — local tracked edits, divergent
    commits, and shipped workflows are discarded. Untracked or ignored user
    workflows and other local-only files are left alone.
    """
    root = root or _plugin_root()
    if not _UPDATE_LOCK.acquire(blocking=False):
        return _empty_payload(
            error="another update or rollback is already running",
            error_code="update_in_progress",
            update_in_progress=True,
        )
    try:
        status = check_plugin_update(fetch=True, root=root)
        if not status.get("ok") or not status.get("is_repo"):
            return status
        if not status.get("update_available") and not status.get("repair_available"):
            status["error"] = "already up to date"
            status["error_code"] = "up_to_date"
            return status

        branch = status.get("branch") or "main"
        remote_ref, target_sha = _resolve_remote_target(root, branch)
        if not remote_ref or not target_sha:
            status["ok"] = False
            status["error"] = "remote tip not found"
            status["error_code"] = "no_remote_tip"
            return status

        previous_p = _run_git(root, "rev-parse", "HEAD")
        previous_sha = (previous_p.stdout or "").strip() if previous_p.returncode == 0 else ""
        if not previous_sha:
            status["ok"] = False
            status["error"] = "local HEAD not found"
            status["error_code"] = "git_error"
            return status
        previous_version = _version_at(root, previous_sha) or str(status.get("local_version") or "")
        backup_dir = _backup_dir(root, previous_sha)
        patch_path = _write_dirty_patch(root, backup_dir)
        local_workflows, moved, local_backups = _prepare_worktree(
            root,
            target_sha,
            backup_dir,
            preserve_tracked_local_workflows=True,
        )
        backup_ref = f"refs/comfytv/update-backup/{backup_dir.name if backup_dir else previous_sha[:12]}"
        ref_p = _run_git(root, "update-ref", backup_ref, previous_sha)
        if ref_p.returncode != 0:
            _restore_moved_files(moved)
            status["ok"] = False
            status["error"] = (ref_p.stderr or ref_p.stdout or "could not create rollback ref").strip()
            status["error_code"] = "backup_failed"
            return status

        reset_p = _run_git(root, "reset", "--hard", target_sha)
        if reset_p.returncode != 0:
            _restore_moved_files(moved)
            status["ok"] = False
            status["error"] = (reset_p.stderr or reset_p.stdout or "git reset --hard failed").strip()
            status["error_code"] = "pull_failed"
            status["backup_path"] = str(backup_dir or "")
            status["local_backups"] = local_backups
            return status

        _restore_local_workflows(root, local_workflows)
        verified, verification_error = _verify_reset(root, target_sha)
        if not verified:
            rollback_p = _run_git(root, "reset", "--hard", previous_sha)
            _restore_moved_files(moved)
            status["ok"] = False
            status["error"] = verification_error
            status["error_code"] = "verification_failed"
            status["rolled_back"] = rollback_p.returncode == 0
            status["backup_path"] = str(backup_dir or "")
            status["local_backups"] = local_backups
            return status

        dependency_files = _changed_dependency_files(root, previous_sha, target_sha)
        refreshed = check_plugin_update(fetch=False, root=root)
        state = {
            "rollback_available": previous_sha != target_sha,
            "previous_sha": previous_sha,
            "previous_version": previous_version,
            "updated_sha": target_sha,
            "updated_version": refreshed.get("local_version") or "",
            "backup_ref": backup_ref,
            "backup_path": str(backup_dir or ""),
            "dirty_patch": patch_path,
            "local_backups": local_backups,
            "dependency_files_changed": dependency_files,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _write_state(root, state)
        _prune_update_backups(root)
        _attach_recovery_state(refreshed, root)
        refreshed["ok"] = True
        refreshed["restart_required"] = True
        refreshed["error"] = ""
        refreshed["error_code"] = ""
        refreshed["forced"] = bool(status.get("dirty") or status.get("ahead", 0) > 0)
        refreshed["update_in_progress"] = False
        return refreshed
    except Exception as error:
        _log.exception("plugin update failed")
        return _empty_payload(error=str(error) or type(error).__name__, error_code="update_failed")
    finally:
        _UPDATE_LOCK.release()


def rollback_plugin_update(*, root: Optional[Path] = None) -> dict[str, Any]:
    root = root or _plugin_root()
    if not _UPDATE_LOCK.acquire(blocking=False):
        return _empty_payload(
            error="another update or rollback is already running",
            error_code="update_in_progress",
            update_in_progress=True,
        )
    try:
        state = _read_state(root)
        target_sha = str(state.get("previous_sha") or "")
        if not state.get("rollback_available") or not _commit_exists(root, target_sha):
            status = check_plugin_update(fetch=False, root=root)
            status["ok"] = False
            status["error"] = "no rollback version is available"
            status["error_code"] = "no_rollback"
            return status

        current_p = _run_git(root, "rev-parse", "HEAD")
        current_sha = (current_p.stdout or "").strip() if current_p.returncode == 0 else ""
        backup_dir = _backup_dir(root, current_sha or target_sha)
        _local_workflows, moved, local_backups = _prepare_worktree(
            root,
            target_sha,
            backup_dir,
            preserve_tracked_local_workflows=False,
        )
        reset_p = _run_git(root, "reset", "--hard", target_sha)
        if reset_p.returncode != 0:
            _restore_moved_files(moved)
            status = check_plugin_update(fetch=False, root=root)
            status["ok"] = False
            status["error"] = (reset_p.stderr or reset_p.stdout or "rollback failed").strip()
            status["error_code"] = "rollback_failed"
            return status

        verified, verification_error = _verify_reset(root, target_sha)
        if not verified:
            if current_sha:
                _run_git(root, "reset", "--hard", current_sha)
            _restore_moved_files(moved)
            status = check_plugin_update(fetch=False, root=root)
            status["ok"] = False
            status["error"] = verification_error
            status["error_code"] = "rollback_verification_failed"
            return status

        state["rollback_available"] = False
        state["rolled_back"] = True
        state["rolled_back_at"] = datetime.now(timezone.utc).isoformat()
        state["local_backups"] = list(state.get("local_backups") or []) + local_backups
        _write_state(root, state)
        refreshed = check_plugin_update(fetch=False, root=root)
        refreshed["ok"] = True
        refreshed["restart_required"] = True
        refreshed["rolled_back"] = True
        refreshed["forced"] = True
        refreshed["error"] = ""
        refreshed["error_code"] = ""
        refreshed["update_in_progress"] = False
        return refreshed
    except Exception as error:
        _log.exception("plugin rollback failed")
        return _empty_payload(error=str(error) or type(error).__name__, error_code="rollback_failed")
    finally:
        _UPDATE_LOCK.release()


@routes.get("/comfytv/plugin/update")
async def get_plugin_update(request: web.Request) -> web.Response:
    fetch = request.rel_url.query.get("fetch", "1") != "0"
    result = await asyncio.to_thread(check_plugin_update, fetch=fetch)
    return web.json_response(result)


@routes.post("/comfytv/plugin/update")
async def post_plugin_update(request: web.Request) -> web.Response:
    return web.json_response(await asyncio.to_thread(apply_plugin_update))


@routes.post("/comfytv/plugin/rollback")
async def post_plugin_rollback(request: web.Request) -> web.Response:
    return web.json_response(await asyncio.to_thread(rollback_plugin_update))
