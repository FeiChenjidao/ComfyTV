"""Per-file Git sync for ComfyUI native workflows (user/default/workflows)."""
from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from aiohttp import web

from ..runners.workflow_db.link import _native_workflows_dir
from ._common import routes

_log = logging.getLogger(__name__)
_GIT_TIMEOUT_S = 120


def _git_bin() -> Optional[str]:
    return shutil.which("git")


def _run_git(root: Path, *args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    git = _git_bin()
    if not git:
        raise RuntimeError("git executable not found on PATH")
    return subprocess.run(
        [git, *args],
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=_GIT_TIMEOUT_S,
        check=check,
    )


def _is_git_repo(root: Path) -> bool:
    """True only if root itself is a git root — not a subfolder of ComfyUI/.git."""
    if not root.is_dir():
        return False
    # Prefer an explicit nested .git (dir or file for worktrees/submodules)
    if not (root / ".git").exists():
        return False
    try:
        r = _run_git(root, "rev-parse", "--show-toplevel")
    except Exception:
        return False
    if r.returncode != 0:
        return False
    try:
        return Path(r.stdout.strip()).resolve() == root.resolve()
    except OSError:
        return False


def _safe_rel_path(root: Path, rel: str) -> Optional[Path]:
    """Resolve rel under root; reject traversal / absolute paths."""
    text = (rel or "").replace("\\", "/").strip().lstrip("/")
    if not text or text.startswith("..") or "/../" in f"/{text}/":
        return None
    try:
        root_r = root.resolve()
        cand = (root_r / text).resolve()
    except OSError:
        return None
    if cand != root_r and root_r not in cand.parents:
        return None
    return cand


def _upstream_ref(root: Path) -> str:
    u = _run_git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if u.returncode == 0 and u.stdout.strip():
        return u.stdout.strip()
    rem = _run_git(root, "remote")
    remotes = [ln.strip() for ln in (rem.stdout or "").splitlines() if ln.strip()]
    remote = "origin" if "origin" in remotes else (remotes[0] if remotes else "")
    br = _run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
    branch = (br.stdout or "").strip() if br.returncode == 0 else "main"
    return f"{remote}/{branch}" if remote else ""


def _porcelain_paths(root: Path) -> set[str]:
    st = _run_git(root, "status", "--porcelain")
    out: set[str] = set()
    for ln in (st.stdout or "").splitlines():
        if not ln.strip():
            continue
        path = ln[3:].strip() if len(ln) >= 4 else ln.strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[-1].strip()
        if path:
            out.add(path.replace("\\", "/"))
    return out


def _remote_diff(root: Path, rel: str, upstream: str) -> bool:
    if not upstream:
        return False
    # Does upstream have this path?
    ls = _run_git(root, "ls-tree", "--name-only", upstream, "--", rel)
    if ls.returncode != 0 or not (ls.stdout or "").strip():
        return False
    # Working tree (or index) vs upstream blob for this path only
    d = _run_git(root, "diff", "--quiet", upstream, "--", rel)
    return d.returncode != 0


def collect_status(root: Optional[Path] = None, *, fetch_remote: bool = True) -> dict[str, Any]:
    root = root or _native_workflows_dir()
    payload: dict[str, Any] = {
        "ok": True,
        "is_repo": False,
        "root": str(root) if root else "",
        "branch": "",
        "remote": "",
        "ahead": 0,
        "behind": 0,
        "dirty": False,
        "changes": [],
        "files": [],
        "has_git": bool(_git_bin()),
        "error": "",
    }
    if root is None:
        payload["ok"] = False
        payload["error"] = "native workflows directory unavailable"
        return payload
    if not payload["has_git"]:
        payload["ok"] = False
        payload["error"] = "git not found on PATH"
        return payload
    if not _is_git_repo(root):
        return payload

    payload["is_repo"] = True
    try:
        br = _run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
        payload["branch"] = (br.stdout or "").strip() if br.returncode == 0 else ""

        rem = _run_git(root, "remote")
        remotes = [ln.strip() for ln in (rem.stdout or "").splitlines() if ln.strip()]
        payload["remote"] = "origin" if "origin" in remotes else (remotes[0] if remotes else "")

        if fetch_remote and payload["remote"]:
            _run_git(root, "fetch", "--quiet", payload["remote"])

        upstream = _upstream_ref(root)
        dirty_paths = _porcelain_paths(root)
        payload["dirty"] = bool(dirty_paths)
        payload["changes"] = sorted(dirty_paths)[:80]

        # All tracked *.json + dirty paths under root
        paths: set[str] = set(dirty_paths)
        for p in root.rglob("*.json"):
            if not p.is_file():
                continue
            rel_parts = p.relative_to(root).parts
            if any(part.startswith(".") for part in rel_parts):
                continue
            if p.stem.endswith("_preset") or p.name.endswith(".api.json"):
                continue
            paths.add(p.relative_to(root).as_posix())

        files: list[dict[str, Any]] = []
        for rel in sorted(paths):
            dirty = rel in dirty_paths
            remote_diff = _remote_diff(root, rel, upstream)
            if not dirty and not remote_diff:
                # still list synced files lightly? skip — UI only needs actionable
                continue
            files.append({
                "path": rel,
                "dirty": dirty,
                "remote_diff": remote_diff,
                "can_update": remote_diff,
                "can_commit": dirty,
            })
        payload["files"] = files
    except subprocess.TimeoutExpired:
        payload["ok"] = False
        payload["error"] = "git timed out"
    except Exception as e:
        _log.warning("[ComfyTV/native-git] status failed: %s", e)
        payload["ok"] = False
        payload["error"] = str(e) or type(e).__name__
    return payload


def pull_file(rel_path: str, root: Optional[Path] = None) -> dict[str, Any]:
    """Overwrite one workflow file from upstream (does not merge the whole branch)."""
    root = root or _native_workflows_dir()
    status = collect_status(root, fetch_remote=True)
    if not status.get("is_repo"):
        status["ok"] = False
        status["error"] = status.get("error") or (
            "not a git repository — clone your team repo into user/default/workflows"
        )
        return status
    assert root is not None
    target = _safe_rel_path(root, rel_path)
    if target is None:
        status["ok"] = False
        status["error"] = "invalid workflow path"
        return status
    rel = target.relative_to(root.resolve()).as_posix()
    try:
        upstream = _upstream_ref(root)
        if not upstream:
            status["ok"] = False
            status["error"] = "no upstream branch configured"
            return status
        ls = _run_git(root, "ls-tree", "--name-only", upstream, "--", rel)
        if ls.returncode != 0 or not (ls.stdout or "").strip():
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = f"file not on remote: {rel}"
            return status
        # Checkout only this path from upstream tip
        r = _run_git(root, "checkout", upstream, "--", rel)
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or "").strip()[:500]
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git checkout failed"
            return status
        status = collect_status(root, fetch_remote=False)
        status["pulled"] = True
        status["path"] = rel
        return status
    except Exception as e:
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        return status


def push_file(rel_path: str, message: str = "", root: Optional[Path] = None) -> dict[str, Any]:
    """Stage + commit + push only one workflow file."""
    root = root or _native_workflows_dir()
    status = collect_status(root, fetch_remote=False)
    if not status.get("is_repo"):
        status["ok"] = False
        status["error"] = status.get("error") or (
            "not a git repository — clone your team repo into user/default/workflows"
        )
        return status
    assert root is not None
    target = _safe_rel_path(root, rel_path)
    if target is None:
        status["ok"] = False
        status["error"] = "invalid workflow path"
        return status
    rel = target.relative_to(root.resolve()).as_posix()
    if not target.is_file() and rel not in _porcelain_paths(root):
        # allow committing a deleted file that's still in porcelain
        if not any(c == rel or c.endswith("/" + rel) for c in status.get("changes") or []):
            status["ok"] = False
            status["error"] = f"workflow file not found: {rel}"
            return status

    name = Path(rel).stem
    msg = (message or "").strip() or f"chore: sync workflow {name}"
    try:
        _run_git(root, "add", "--", rel)
        diff = _run_git(root, "diff", "--cached", "--quiet", "--", rel)
        if diff.returncode == 0:
            # nothing staged for this path — maybe already committed but not pushed?
            # Only push if this path's commit is ahead — too hard; require dirty.
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = "no local changes for this workflow"
            return status

        c = _run_git(root, "commit", "-m", msg)
        if c.returncode != 0:
            detail = (c.stderr or c.stdout or "").strip()[:500]
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git commit failed"
            return status

        remote = status.get("remote") or "origin"
        branch = status.get("branch") or "main"
        p = _run_git(root, "push", remote, branch)
        if p.returncode != 0:
            p = _run_git(root, "push")
        if p.returncode != 0:
            detail = (p.stderr or p.stdout or "").strip()[:500]
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git push failed"
            return status
        status = collect_status(root, fetch_remote=False)
        status["pushed"] = True
        status["path"] = rel
        return status
    except Exception as e:
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        return status


def _remote_json_index(root: Path, upstream: str) -> tuple[set[str], set[str]]:
    """Return (remote_paths, remote_basenames) for *.json on upstream."""
    paths: set[str] = set()
    names: set[str] = set()
    if not upstream:
        return paths, names
    ls = _run_git(root, "ls-tree", "-r", "--name-only", upstream)
    if ls.returncode != 0:
        return paths, names
    for line in (ls.stdout or "").splitlines():
        rel = line.strip().replace("\\", "/")
        if not rel.endswith(".json"):
            continue
        if rel.endswith(".api.json") or rel.endswith("_preset.json"):
            continue
        paths.add(rel)
        names.add(Path(rel).name.lower())
    return paths, names


def pull_repo(root: Optional[Path] = None) -> dict[str, Any]:
    """Fast-forward pull the dedicated workflows library (not parent ComfyUI)."""
    root = root or _native_workflows_dir()
    status = collect_status(root, fetch_remote=True)
    if not status.get("is_repo"):
        status["ok"] = False
        status["error"] = status.get("error") or (
            "not a git repository — init a dedicated repo in user/default/workflows"
        )
        return status
    assert root is not None
    try:
        remote = status.get("remote") or "origin"
        branch = status.get("branch") or "main"
        r = _run_git(root, "pull", "--ff-only", remote, branch)
        if r.returncode != 0:
            r = _run_git(root, "pull", "--ff-only")
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or "").strip()[:500]
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git pull failed (diverging history — use a dedicated workflows repo)"
            return status
        status = collect_status(root, fetch_remote=False)
        status["pulled"] = True
        return status
    except Exception as e:
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        return status


def push_paths(
    rel_paths: list[str],
    message: str = "",
    root: Optional[Path] = None,
) -> dict[str, Any]:
    """Commit+push selected local workflows. Refuse if remote already has same path/name."""
    root = root or _native_workflows_dir()
    status = collect_status(root, fetch_remote=True)
    if not status.get("is_repo"):
        status["ok"] = False
        status["error"] = status.get("error") or (
            "not a git repository — init a dedicated repo in user/default/workflows"
        )
        return status
    assert root is not None

    cleaned: list[str] = []
    for raw in rel_paths or []:
        target = _safe_rel_path(root, str(raw))
        if target is None or not target.is_file():
            status["ok"] = False
            status["error"] = f"workflow file not found: {raw}"
            status["duplicates"] = []
            return status
        cleaned.append(target.relative_to(root.resolve()).as_posix())

    if not cleaned:
        status["ok"] = False
        status["error"] = "no workflows selected"
        status["duplicates"] = []
        return status

    # Reject duplicate basenames within the selection itself
    seen_names: dict[str, str] = {}
    for rel in cleaned:
        key = Path(rel).name.lower()
        if key in seen_names:
            status["ok"] = False
            status["error"] = "duplicate names in selection"
            status["duplicates"] = [seen_names[key], rel]
            return status
        seen_names[key] = rel

    upstream = _upstream_ref(root)
    remote_paths, remote_names = _remote_json_index(root, upstream)
    # Map basename -> remote path(s) for clearer duplicate messages
    remote_by_base: dict[str, list[str]] = {}
    for rp in remote_paths:
        remote_by_base.setdefault(Path(rp).name.lower(), []).append(rp)

    duplicates: list[str] = []
    for rel in cleaned:
        base = Path(rel).name.lower()
        # Same path or same filename already on remote → refuse (no overwrite).
        if rel in remote_paths or base in remote_names or remote_by_base.get(base):
            duplicates.append(rel)
    if duplicates:
        status["ok"] = False
        status["error"] = "remote already has workflow(s) with the same name"
        status["duplicates"] = duplicates
        return status

    msg = (message or "").strip() or (
        f"chore: add workflow {Path(cleaned[0]).stem}"
        if len(cleaned) == 1
        else f"chore: add {len(cleaned)} workflows"
    )
    try:
        _run_git(root, "add", "--", *cleaned)
        diff = _run_git(root, "diff", "--cached", "--quiet")
        if diff.returncode == 0:
            # Selected files identical to index — still allow if untracked were added;
            # if truly nothing staged, fail.
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = "nothing to commit for the selected workflows"
            status["duplicates"] = []
            return status

        c = _run_git(root, "commit", "-m", msg)
        if c.returncode != 0:
            detail = (c.stderr or c.stdout or "").strip()[:500]
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git commit failed"
            status["duplicates"] = []
            return status

        remote = status.get("remote") or "origin"
        branch = status.get("branch") or "main"
        p = _run_git(root, "push", remote, branch)
        if p.returncode != 0:
            p = _run_git(root, "push")
        if p.returncode != 0:
            detail = (p.stderr or p.stdout or "").strip()[:500]
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git push failed"
            status["duplicates"] = []
            return status

        status = collect_status(root, fetch_remote=False)
        status["pushed"] = True
        status["paths"] = cleaned
        status["duplicates"] = []
        return status
    except Exception as e:
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        status["duplicates"] = []
        return status


@routes.get("/comfytv/workflows/native/git")
async def native_git_status(_request: web.Request) -> web.Response:
    data = await asyncio.to_thread(collect_status)
    return web.json_response(data)


@routes.post("/comfytv/workflows/native/git/pull")
async def native_git_pull(_request: web.Request) -> web.Response:
    data = await asyncio.to_thread(pull_repo)
    return web.json_response(data)


@routes.post("/comfytv/workflows/native/git/push")
async def native_git_push(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}
    message = str((body or {}).get("message") or "")
    paths_raw = (body or {}).get("paths")
    path = str((body or {}).get("path") or "").strip()
    if isinstance(paths_raw, list) and paths_raw:
        paths = [str(p) for p in paths_raw]
        data = await asyncio.to_thread(push_paths, paths, message)
        return web.json_response(data)
    if path:
        # legacy single-path: still refuse if remote duplicate
        data = await asyncio.to_thread(push_paths, [path], message)
        return web.json_response(data)
    data = {
        "ok": False,
        "is_repo": False,
        "root": "",
        "branch": "",
        "remote": "",
        "ahead": 0,
        "behind": 0,
        "dirty": False,
        "changes": [],
        "files": [],
        "has_git": bool(_git_bin()),
        "error": "select at least one local workflow to commit",
        "duplicates": [],
    }
    return web.json_response(data)
