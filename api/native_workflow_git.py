"""Per-file Git sync for ComfyUI native workflows (user/default/workflows)."""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from aiohttp import web

from ..runners.workflow_db.link import _native_workflows_dir, resolve_request_user_id
from . import native_workflow_assets
from ._common import routes


def _workflows_root(root: Optional[Path] = None, user_id: Optional[str] = None) -> Optional[Path]:
    return root or _native_workflows_dir(user_id)

_log = logging.getLogger(__name__)
_GIT_TIMEOUT_S = 120
_TOKEN_NAME = ".comfytv-git-token"
_REMOTE_NAME = ".comfytv-git-remote"
# Bundled with the plugin so "update ComfyTV only" still seeds credentials.
_SECRETS_DIRNAME = "secrets"
_SEED_TOKEN_NAME = "comfytv-git-token"
_SEED_REMOTE_NAME = "comfytv-git-remote"
# Public team library used when colleagues update the plugin but have no local .git yet.
_DEFAULT_REMOTE = "https://github.com/FeiChenjidao/comfytv-team-workflows.git"
_AUTH_IN_URL_RE = re.compile(
    r"^(?P<scheme>https?://)(?:(?P<user>[^:@/]+)(?::(?P<pw>[^@/]*))?@)?(?P<rest>.+)$",
    re.IGNORECASE,
)


def _plugin_root() -> Path:
    # api/native_workflow_git.py → ComfyTV/
    return Path(__file__).resolve().parents[1]


def _secrets_dir() -> Path:
    return _plugin_root() / _SECRETS_DIRNAME


def _git_bin() -> Optional[str]:
    return shutil.which("git")


def _run_git(root: Path, *args: str, check: bool = False) -> subprocess.CompletedProcess[str]:
    git = _git_bin()
    if not git:
        raise RuntimeError("git executable not found on PATH")
    # Never pop interactive Git Credential Manager / login dialogs from UI threads.
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
        check=check,
        env=env,
    )


def _read_text_file(path: Path) -> str:
    try:
        # utf-8-sig strips BOM from PowerShell Set-Content files
        return path.read_text(encoding="utf-8-sig").strip()
    except OSError:
        return ""


def _read_token(root: Path) -> str:
    return _read_text_file(root / _TOKEN_NAME)


def _read_configured_remote(root: Path) -> str:
    raw = _read_text_file(root / _REMOTE_NAME)
    if raw:
        return _strip_auth(raw.splitlines()[0].strip())
    return ""


def _ensure_workflow_credentials(root: Path) -> None:
    """After plugin update: seed token/remote into the current user's workflows dir.

    Colleagues who only update ComfyTV get working team-git auth. Existing local
    files are never overwritten.
    """
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        _log.warning("[ComfyTV/native-git] cannot create workflows dir: %s", e)
        return

    secrets = _secrets_dir()
    seed_tok = secrets / _SEED_TOKEN_NAME
    seed_rem = secrets / _SEED_REMOTE_NAME
    dest_tok = root / _TOKEN_NAME
    dest_rem = root / _REMOTE_NAME

    if not dest_tok.exists() and seed_tok.is_file():
        try:
            text = _read_text_file(seed_tok)
            if text:
                dest_tok.write_text(text + "\n", encoding="utf-8")
                _log.info("[ComfyTV/native-git] seeded %s from plugin secrets", _TOKEN_NAME)
        except OSError as e:
            _log.warning("[ComfyTV/native-git] could not seed token: %s", e)

    if not dest_rem.exists():
        remote = _read_text_file(seed_rem) if seed_rem.is_file() else ""
        remote = _strip_auth((remote.splitlines()[0] if remote else "").strip()) or _DEFAULT_REMOTE
        try:
            dest_rem.write_text(remote + "\n", encoding="utf-8")
        except OSError as e:
            _log.warning("[ComfyTV/native-git] could not seed remote: %s", e)


def _normalize_remote_url(url: str) -> str:
    """Canonical clean remote URL. GitHub PAT auth requires https (not http)."""
    text = (url or "").strip()
    if not text:
        return ""
    # Common misconfig: http://github.com/... → PAT auth fails with
    # "Invalid username or token" / "Password authentication is not supported".
    if text.lower().startswith("http://github.com/"):
        text = "https://" + text[7:]
    elif text.lower().startswith("http://www.github.com/"):
        text = "https://" + text[7:]
    return text


def _split_auth(url: str) -> tuple[str, str]:
    """Return (clean_https_url, token_or_password)."""
    text = (url or "").strip()
    if not text:
        return "", ""
    m = _AUTH_IN_URL_RE.match(text)
    if not m or not m.group("user"):
        return _normalize_remote_url(text), ""
    user = unquote(m.group("user") or "")
    pw = unquote(m.group("pw") or "")
    # GitHub PAT style: x-access-token:PAT or oauth2:TOKEN or PAT as user
    token = pw or user
    if user.lower() in ("x-access-token", "oauth2", "git") and pw:
        token = pw
    clean = _normalize_remote_url(f"{m.group('scheme')}{m.group('rest')}")
    return clean, token


def _strip_auth(url: str) -> str:
    return _split_auth(url)[0]


def _with_token(url: str, token: str) -> str:
    clean = _normalize_remote_url(_strip_auth(url))
    tok = (token or "").strip()
    if not clean or not tok:
        return clean
    parts = urlsplit(clean)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return clean
    # Always https for github.com when injecting a PAT
    scheme = parts.scheme
    host = (parts.hostname or "").lower()
    if host in ("github.com", "www.github.com") and scheme == "http":
        scheme = "https"
    # Never log this URL — used only for ephemeral git remotes.
    netloc = f"x-access-token:{quote(tok, safe='')}@{parts.netloc}"
    if host in ("github.com", "www.github.com"):
        # Rebuild netloc without forcing port quirks: userinfo@host[:port]
        hostport = parts.netloc.split("@")[-1]
        netloc = f"x-access-token:{quote(tok, safe='')}@{hostport}"
    return urlunsplit((scheme, netloc, parts.path, parts.query, parts.fragment))


def _ensure_local_identity(root: Path) -> None:
    name = _run_git(root, "config", "--local", "--get", "user.name")
    email = _run_git(root, "config", "--local", "--get", "user.email")
    if name.returncode != 0 or not (name.stdout or "").strip():
        _run_git(root, "config", "--local", "user.name", "ComfyTV Workflows")
    if email.returncode != 0 or not (email.stdout or "").strip():
        _run_git(root, "config", "--local", "user.email", "comfytv-workflows@local")


def _origin_url(root: Path) -> str:
    r = _run_git(root, "remote", "get-url", "origin")
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


def _sanitize_origin_remote(root: Path) -> None:
    """Move embedded PATs out of origin URL into .comfytv-git-token; force https for GitHub."""
    raw = _origin_url(root)
    if not raw:
        return
    clean, token = _split_auth(raw)
    clean = _normalize_remote_url(clean)
    if token:
        tok_path = root / _TOKEN_NAME
        if not tok_path.exists():
            try:
                tok_path.write_text(token + "\n", encoding="utf-8")
            except OSError as e:
                _log.warning("[ComfyTV/native-git] could not write token file: %s", e)
    if clean and clean != raw:
        _run_git(root, "remote", "set-url", "origin", clean)
    if clean and not _read_configured_remote(root):
        try:
            (root / _REMOTE_NAME).write_text(clean + "\n", encoding="utf-8")
        except OSError:
            pass


def _refresh_token_from_plugin(root: Path, *, force: bool = False) -> bool:
    """Copy plugin-bundled PAT into workflows dir. force=True overwrites a bad local token."""
    seed = _secrets_dir() / _SEED_TOKEN_NAME
    dest = root / _TOKEN_NAME
    if not seed.is_file():
        return False
    text = _read_text_file(seed)
    if not text:
        return False
    if dest.exists() and not force:
        return False
    try:
        dest.write_text(text + "\n", encoding="utf-8")
        return True
    except OSError as e:
        _log.warning("[ComfyTV/native-git] could not refresh token: %s", e)
        return False


@contextmanager
def _authed_origin(root: Path) -> Iterator[None]:
    """Temporarily inject token into origin for network ops; restore clean URL after."""
    _ensure_workflow_credentials(root)
    clean = _normalize_remote_url(
        _strip_auth(_origin_url(root)) or _read_configured_remote(root) or _DEFAULT_REMOTE
    )
    token = _read_token(root)
    if not token:
        # Old/empty local token — pick up the plugin-bundled PAT.
        _refresh_token_from_plugin(root, force=True)
        token = _read_token(root)
    if not token or not clean.startswith("http"):
        yield
        return
    # Persist https clean URL so future ops never hit http://github.com
    cur = _strip_auth(_origin_url(root))
    if clean and clean != cur:
        rem_chk = _run_git(root, "remote")
        remotes_chk = [ln.strip() for ln in (rem_chk.stdout or "").splitlines() if ln.strip()]
        if "origin" in remotes_chk:
            _run_git(root, "remote", "set-url", "origin", clean)
        try:
            (root / _REMOTE_NAME).write_text(clean + "\n", encoding="utf-8")
        except OSError:
            pass
    authed = _with_token(clean, token)
    rem = _run_git(root, "remote")
    remotes = [ln.strip() for ln in (rem.stdout or "").splitlines() if ln.strip()]
    if "origin" not in remotes:
        _run_git(root, "remote", "add", "origin", authed)
    else:
        _run_git(root, "remote", "set-url", "origin", authed)
    try:
        yield
    finally:
        try:
            _run_git(root, "remote", "set-url", "origin", clean)
        except Exception:
            pass


def _copy_missing(src: Path, dst: Path) -> None:
    """Copy files from src → dst without overwriting existing paths."""
    if not src.is_dir():
        return
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(src)
        if rel.parts and rel.parts[0] == ".git":
            continue
        target = dst / rel
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


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


def _porcelain_entries(root: Path) -> dict[str, str]:
    """Map rel path → 2-char porcelain code (e.g. '??', ' M', 'M ', 'A ')."""
    # quotepath=false so CJK names like 刺绣.json match UI paths (not \345\210\272…)
    st = _run_git(root, "-c", "core.quotepath=false", "status", "--porcelain", "-u")
    out: dict[str, str] = {}
    for ln in (st.stdout or "").splitlines():
        if not ln.strip():
            continue
        code = ln[:2] if len(ln) >= 2 else ""
        path = ln[3:].strip() if len(ln) >= 4 else ln.strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[-1].strip()
        if len(path) >= 2 and path[0] == '"' and path[-1] == '"':
            path = path[1:-1]
        if path:
            out[path.replace("\\", "/")] = code
    return out


def _porcelain_paths(root: Path) -> set[str]:
    return set(_porcelain_entries(root))


def _is_workflow_rel(rel: str) -> bool:
    """True for team-library GUI workflows (ignore token/remote/docs dirtiness)."""
    text = (rel or "").replace("\\", "/").strip().lstrip("/")
    if not text.endswith(".json"):
        return False
    parts = text.split("/")
    if any(p.startswith(".") for p in parts):
        return False
    name = parts[-1]
    if name.endswith(".api.json") or Path(name).stem.endswith("_preset"):
        return False
    return True


def _committed_diff_vs_upstream(root: Path, rel: str, upstream: str) -> bool:
    """True when HEAD's blob for rel differs from upstream (ignores working-tree edits)."""
    if not upstream:
        return False
    ls = _run_git(root, "ls-tree", "--name-only", upstream, "--", rel)
    if ls.returncode != 0 or not (ls.stdout or "").strip():
        # Also "diff" if we have it locally committed but remote deleted it
        local = _run_git(root, "ls-tree", "--name-only", "HEAD", "--", rel)
        return local.returncode == 0 and bool((local.stdout or "").strip())
    # Compare trees only — local unsaved/uncommitted edits must not look like "Update available"
    d = _run_git(root, "diff", "--quiet", "HEAD", upstream, "--", rel)
    return d.returncode != 0


def _ahead_behind(root: Path, upstream: str) -> tuple[int, int]:
    if not upstream:
        return 0, 0
    r = _run_git(root, "rev-list", "--left-right", "--count", f"HEAD...{upstream}")
    if r.returncode != 0:
        return 0, 0
    parts = (r.stdout or "").strip().split()
    if len(parts) != 2:
        return 0, 0
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return 0, 0


def _is_non_ff_push_error(detail: str) -> bool:
    text = (detail or "").lower()
    return any(
        s in text
        for s in (
            "non-fast-forward",
            "fetch first",
            "tip of your current branch is behind",
            "updates were rejected",
            "[rejected]",
        )
    )


def _push_current_branch(root: Path, remote: str, branch: str) -> subprocess.CompletedProcess[str]:
    with _authed_origin(root):
        p = _run_git(root, "push", remote, branch)
        if p.returncode != 0:
            p = _run_git(root, "push")
    return p


def collect_status(
    root: Optional[Path] = None,
    *,
    fetch_remote: bool = False,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    root = _workflows_root(root, user_id)
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
        "remote_workflows": [],
        "has_git": bool(_git_bin()),
        "error": "",
        "user_id": user_id or "default",
    }
    if root is None:
        payload["ok"] = False
        payload["error"] = "native workflows directory unavailable"
        return payload
    if not payload["has_git"]:
        payload["ok"] = False
        payload["error"] = "git not found on PATH"
        return payload
    _ensure_workflow_credentials(root)

    if not _is_git_repo(root):
        payload["default_remote"] = _read_configured_remote(root) or _DEFAULT_REMOTE
        return payload

    payload["is_repo"] = True
    try:
        _sanitize_origin_remote(root)
        _ensure_local_identity(root)
        br = _run_git(root, "rev-parse", "--abbrev-ref", "HEAD")
        payload["branch"] = (br.stdout or "").strip() if br.returncode == 0 else ""

        rem = _run_git(root, "remote")
        remotes = [ln.strip() for ln in (rem.stdout or "").splitlines() if ln.strip()]
        payload["remote"] = "origin" if "origin" in remotes else (remotes[0] if remotes else "")
        payload["default_remote"] = _strip_auth(_origin_url(root)) or _read_configured_remote(root) or _DEFAULT_REMOTE

        if fetch_remote and payload["remote"]:
            # Silent remote check: use .comfytv-git-token when present; never open a login UI.
            try:
                with _authed_origin(root):
                    fr = _run_git(root, "fetch", "--quiet", payload["remote"])
                if fr.returncode != 0:
                    detail = (fr.stderr or fr.stdout or "").strip()[:240]
                    tok = _read_token(root)
                    if tok:
                        detail = detail.replace(tok, "***")
                    # Soft-fail — still return local status so the panel stays usable.
                    payload["fetch_error"] = detail or "git fetch failed"
            except Exception as e:
                payload["fetch_error"] = str(e) or type(e).__name__

        upstream = _upstream_ref(root)
        ahead, behind = _ahead_behind(root, upstream)
        payload["ahead"] = ahead
        payload["behind"] = behind
        porcelain = _porcelain_entries(root)
        dirty_paths = set(porcelain)
        dirty_workflows = {p for p in dirty_paths if _is_workflow_rel(p)}
        # Hint "本地有未提交改动" only when a workflow JSON changed — not .comfytv-git-* etc.
        payload["dirty"] = bool(dirty_workflows)
        payload["changes"] = sorted(dirty_workflows)[:80]

        remote = str(payload.get("remote") or "origin")
        branch = str(payload.get("branch") or "main")
        tip = upstream or (f"{remote}/{branch}" if remote and branch else "")
        remote_workflows = sorted(
            p for p in (_remote_tree_paths(root, remote, branch) if tip else set())
            if _is_workflow_rel(p)
        )
        remote_set = set(remote_workflows)
        payload["remote_workflows"] = remote_workflows

        # Workflow JSON on disk + dirty workflow paths + remote-only templates
        paths: set[str] = set(dirty_workflows) | remote_set
        for p in root.rglob("*.json"):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if not _is_workflow_rel(rel):
                continue
            paths.add(rel)

        files: list[dict[str, Any]] = []
        for rel in sorted(paths):
            code = porcelain.get(rel, "")
            untracked = code.strip() == "??" or code == "??"
            dirty = rel in dirty_workflows
            on_remote = rel in remote_set
            # 模板 = 云端有的；工作流 = 仅本地
            kind = "template" if on_remote else "local"
            # "可更新" = remote tip changed this file vs our HEAD, and we are behind.
            # Do NOT use working-tree diff — local edits must show as 已改动 only.
            committed_diff = (
                False if untracked
                else _committed_diff_vs_upstream(root, rel, upstream)
            )
            remote_diff = bool(on_remote and committed_diff and behind > 0)
            missing_local = on_remote and not (root / rel).is_file()
            if not dirty and not remote_diff and not missing_local and on_remote:
                # Synced template — still list for UI split (kind only)
                files.append({
                    "path": rel,
                    "dirty": False,
                    "untracked": False,
                    "remote_diff": False,
                    "can_update": False,
                    "can_commit": False,
                    "state": "synced",
                    "kind": kind,
                })
                continue
            if not dirty and not remote_diff and not missing_local and not on_remote:
                # Local file with no git dirt — still list as local workflow
                files.append({
                    "path": rel,
                    "dirty": False,
                    "untracked": untracked,
                    "remote_diff": False,
                    "can_update": False,
                    "can_commit": untracked,
                    "state": "new" if untracked else "synced",
                    "kind": kind,
                })
                continue
            if untracked and not on_remote:
                state = "new"
            elif missing_local:
                state = "outdated"
            elif dirty and remote_diff:
                state = "diverged"
            elif dirty:
                state = "modified"
            elif remote_diff:
                state = "outdated"
            else:
                state = "synced"
            files.append({
                "path": rel,
                "dirty": dirty,
                "untracked": untracked,
                "remote_diff": remote_diff or missing_local,
                "can_update": remote_diff or missing_local,
                "can_commit": dirty and not missing_local,
                "state": state,
                "kind": kind,
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


def pull_file(
    rel_path: str,
    root: Optional[Path] = None,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """Overwrite one workflow file from upstream (does not merge the whole branch)."""
    root = _workflows_root(root, user_id)
    status = collect_status(root, fetch_remote=True, user_id=user_id)
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


def push_file(
    rel_path: str,
    message: str = "",
    root: Optional[Path] = None,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """Stage + commit + push only one workflow file."""
    root = _workflows_root(root, user_id)
    status = collect_status(root, fetch_remote=False, user_id=user_id)
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


def _remote_tree_paths(root: Path, remote: str, branch: str) -> set[str]:
    """Paths present on the tracking tip (after fetch). Empty if unavailable."""
    tip = f"{remote}/{branch}"
    r = _run_git(root, "-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", tip)
    if r.returncode != 0:
        return set()
    return {ln.strip().replace("\\", "/") for ln in (r.stdout or "").splitlines() if ln.strip()}


def _untracked_paths(root: Path) -> list[str]:
    r = _run_git(root, "-c", "core.quotepath=false", "status", "--porcelain", "-u")
    if r.returncode != 0:
        return []
    out: list[str] = []
    for ln in (r.stdout or "").splitlines():
        if not ln.startswith("??"):
            continue
        rel = ln[3:].strip().replace("\\", "/").rstrip("/")
        if rel:
            out.append(rel)
    return out


def _unique_backup_path(path: Path) -> Path:
    """Pick path.json.local-backup, or .local-backup-2, … if already taken."""
    base = Path(str(path) + ".local-backup")
    if not base.exists():
        return base
    for i in range(2, 50):
        cand = Path(str(path) + f".local-backup-{i}")
        if not cand.exists():
            return cand
    return Path(str(path) + f".local-backup-{os.getpid()}")


def quarantine_untracked_collisions(
    root: Path, remote: str = "origin", branch: str = "main"
) -> list[str]:
    """Rename local untracked files that would block checkout of the same remote path.

    Colleagues often drop a workflow JSON into the folder without committing; pull then
    fails with 'untracked working tree files would be overwritten by checkout'.
    """
    remote_paths = _remote_tree_paths(root, remote, branch)
    if not remote_paths:
        return []
    moved: list[str] = []
    for rel in _untracked_paths(root):
        if rel not in remote_paths:
            continue
        src = root / rel
        if not src.is_file():
            continue
        dest = _unique_backup_path(src)
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dest)
            moved.append(rel)
            _log.info("quarantined untracked %s -> %s", rel, dest.name)
        except OSError as e:
            _log.warning("could not quarantine %s: %s", rel, e)
    return moved


_OVERWRITE_UNTRACKED_RE = re.compile(
    r"untracked working tree files would be overwritten by checkout:\s*(.+?)(?:Please move|Aborting)",
    re.IGNORECASE | re.DOTALL,
)


def _parse_overwrite_untracked(detail: str) -> list[str]:
    m = _OVERWRITE_UNTRACKED_RE.search(detail or "")
    if not m:
        return []
    names: list[str] = []
    for ln in m.group(1).splitlines():
        name = ln.strip().replace("\\", "/")
        if name and not name.lower().startswith("please"):
            names.append(name)
    return names


def _overwrite_templates_from_tip(root: Path, remote: str, branch: str) -> list[str]:
    """Checkout every remote workflow JSON from tip into the working tree (overwrite).

    Local-only files (not on remote) are untouched. Used so「更新」always replaces
    template copies with the cloud version.
    """
    tip = f"{remote}/{branch}"
    remote_wfs = [p for p in _remote_tree_paths(root, remote, branch) if _is_workflow_rel(p)]
    if not remote_wfs:
        return []
    # Checkout in batches to avoid argv limits on huge libraries
    done: list[str] = []
    batch: list[str] = []
    for rel in remote_wfs:
        batch.append(rel)
        if len(batch) >= 40:
            r = _run_git(root, "checkout", tip, "--", *batch)
            if r.returncode == 0:
                done.extend(batch)
            batch = []
    if batch:
        r = _run_git(root, "checkout", tip, "--", *batch)
        if r.returncode == 0:
            done.extend(batch)
    return done


def _working_tree_dirty(root: Path) -> bool:
    """True when there are staged or unstaged changes (untracked ignored)."""
    r = _run_git(root, "status", "--porcelain", "-uno")
    return bool((r.stdout or "").strip())


def _stash_for_pull(root: Path) -> bool:
    """Stash tracked + untracked (except ignored) so pull --rebase can run.

    Local-only workflows are restored with stash pop after pull.
    """
    # Avoid pushing an empty stash
    por = _run_git(root, "-c", "core.quotepath=false", "status", "--porcelain", "-u")
    if not (por.stdout or "").strip():
        return False
    r = _run_git(
        root,
        "stash",
        "push",
        "-u",
        "-m",
        "comfytv-auto-before-pull",
    )
    return r.returncode == 0


def _stash_pop_safe(root: Path) -> list[str]:
    """Pop auto-stash; on conflict keep stash and return warning strings."""
    warnings: list[str] = []
    listed = _run_git(root, "stash", "list")
    if "comfytv-auto-before-pull" not in (listed.stdout or ""):
        return warnings
    r = _run_git(root, "stash", "pop")
    if r.returncode != 0:
        detail = (r.stderr or r.stdout or "").strip()[:240]
        warnings.append(
            "local edits were stashed as comfytv-auto-before-pull; "
            f"stash pop had issues: {detail or 'conflict'}"
        )
    return warnings


def pull_repo(root: Optional[Path] = None, user_id: Optional[str] = None) -> dict[str, Any]:
    """Pull team templates: overwrite cloud workflows locally; keep local-only files."""
    root = _workflows_root(root, user_id)
    status = collect_status(root, fetch_remote=True, user_id=user_id)
    if not status.get("is_repo"):
        status["ok"] = False
        status["error"] = status.get("error") or (
            "not a git repository — connect the team workflows repo first"
        )
        return status
    assert root is not None
    stashed = False
    try:
        remote = status.get("remote") or "origin"
        branch = status.get("branch") or "main"
        # Avoid "untracked … would be overwritten by checkout" (common colleague case).
        local_backups = quarantine_untracked_collisions(root, remote, branch)
        # pull --rebase refuses dirty trees — stash local work first (incl. untracked).
        if _working_tree_dirty(root) or _untracked_paths(root):
            stashed = _stash_for_pull(root)
        with _authed_origin(root):
            upstream = _upstream_ref(root) or f"{remote}/{branch}"
            ahead_now, behind_now = _ahead_behind(root, upstream)
            r: subprocess.CompletedProcess[str]
            if behind_now > 0 and ahead_now == 0:
                # Align HEAD to remote; untracked local workflows kept if not stashed,
                # or restored via stash pop below.
                r = _run_git(root, "reset", "--hard", upstream)
            else:
                r = _run_git(root, "pull", "--ff-only", remote, branch)
                if r.returncode != 0:
                    r = _run_git(root, "pull", "--ff-only")
                # After a rejected push, local has commits remote doesn't — rebase onto remote.
                if r.returncode != 0:
                    # Rebase needs a clean tree; stash again if something re-dirtied.
                    if _working_tree_dirty(root) and not stashed:
                        stashed = _stash_for_pull(root)
                    r = _run_git(root, "pull", "--rebase", remote, branch)
                if r.returncode != 0:
                    detail_l = (r.stderr or r.stdout or "").lower()
                    if "unstaged" in detail_l or "uncommitted" in detail_l:
                        if _stash_for_pull(root):
                            stashed = True
                        r = _run_git(root, "pull", "--rebase", remote, branch)
                    if r.returncode != 0:
                        r = _run_git(root, "pull", "--rebase")
            # One more chance: parse overwrite error and quarantine those names.
            if r.returncode != 0:
                detail = (r.stderr or r.stdout or "")
                if "overwritten by checkout" in detail.lower():
                    extra = _parse_overwrite_untracked(detail)
                    for rel in extra:
                        src = root / rel
                        if src.is_file():
                            try:
                                src.rename(_unique_backup_path(src))
                                local_backups.append(rel)
                            except OSError:
                                pass
                    if extra:
                        r = _run_git(root, "pull", "--ff-only", remote, branch)
                        if r.returncode != 0:
                            r = _run_git(root, "pull", "--rebase", remote, branch)
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or "").strip()[:500]
            # Leave a half-finished rebase in a recoverable state
            if (root / ".git" / "rebase-merge").exists() or (root / ".git" / "rebase-apply").exists():
                _run_git(root, "rebase", "--abort")
            if stashed:
                _stash_pop_safe(root)
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error_code"] = "pull_conflict"
            status["error"] = detail or "git pull failed"
            status["local_backups"] = local_backups
            return status
        # Templates: force-overwrite from tip after HEAD moved (云端有更新直接覆盖).
        overwritten = _overwrite_templates_from_tip(root, remote, branch)
        stash_warnings = _stash_pop_safe(root) if stashed else []
        restored = native_workflow_assets.restore_assets(root)
        status = collect_status(root, fetch_remote=False)
        status["pulled"] = True
        status["assets_restored"] = restored.restored
        status["assets_skipped"] = restored.skipped
        status["assets_warnings"] = (restored.warnings + stash_warnings)[:40]
        status["local_backups"] = local_backups
        status["templates_overwritten"] = overwritten
        return status
    except Exception as e:
        if stashed:
            _stash_pop_safe(root)
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        return status


def setup_repo(
    remote_url: str = "",
    root: Optional[Path] = None,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """One-click connect: clone team repo into the current user's workflows dir.

    Multi-user: each account gets ``user/<id>/workflows`` with its own .git.
    Preserves existing local JSON; fills missing files from the team remote.
    """
    root = _workflows_root(root, user_id)
    if root is None:
        return {
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
            "error": "native workflows directory unavailable",
            "default_remote": _DEFAULT_REMOTE,
            "user_id": user_id or "default",
        }
    if not _git_bin():
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = "git not found on PATH"
        return status
    _ensure_workflow_credentials(root)

    if _is_git_repo(root):
        status = collect_status(root, fetch_remote=True)
        status["setup"] = True
        return status

    clean = _strip_auth((remote_url or "").strip()) or _read_configured_remote(root) or _DEFAULT_REMOTE
    token = _read_token(root)
    clone_url = _with_token(clean, token) if token else clean

    root.mkdir(parents=True, exist_ok=True)
    parent = root.parent
    tmp: Optional[Path] = None
    try:
        tmp = Path(tempfile.mkdtemp(prefix=".comfytv_wf_clone_", dir=str(parent)))
        # Clone into empty temp dir (git requires target empty / non-existent)
        clone_target = tmp / "repo"
        r = _run_git(
            parent,
            "clone",
            "--depth",
            "1",
            clone_url,
            str(clone_target),
        )
        if r.returncode != 0:
            detail = (r.stderr or r.stdout or "").strip()[:500]
            # Redact token if somehow present in stderr
            if token:
                detail = detail.replace(token, "***")
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = detail or "git clone failed"
            status["default_remote"] = clean
            return status

        git_src = clone_target / ".git"
        git_dst = root / ".git"
        if git_dst.exists():
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error"] = "workflows/.git already exists but is not a valid dedicated repo"
            return status
        shutil.move(str(git_src), str(git_dst))
        _copy_missing(clone_target, root)
        _run_git(root, "remote", "set-url", "origin", clean)
        try:
            (root / _REMOTE_NAME).write_text(clean + "\n", encoding="utf-8")
        except OSError:
            pass
        _ensure_local_identity(root)

        # Align index with remote tip without wiping local-only files
        _run_git(root, "reset", "--mixed", "HEAD")

        restored = native_workflow_assets.restore_assets(root)
        status = collect_status(root, fetch_remote=True)
        status["setup"] = True
        status["ok"] = bool(status.get("is_repo"))
        status["assets_restored"] = restored.restored
        status["assets_skipped"] = restored.skipped
        status["assets_warnings"] = restored.warnings[:40]
        if not status["ok"]:
            status["error"] = status.get("error") or "setup finished but repo check failed"
        return status
    except Exception as e:
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        status["default_remote"] = clean
        return status
    finally:
        if tmp is not None:
            shutil.rmtree(tmp, ignore_errors=True)


def push_paths(
    rel_paths: list[str],
    message: str = "",
    root: Optional[Path] = None,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """Commit+push selected local workflows. Refuse if remote already has same path/name."""
    root = _workflows_root(root, user_id)
    status = collect_status(root, fetch_remote=True, user_id=user_id)
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
        # Same path already on remote → allowed (local edit / update).
        if rel in remote_paths:
            continue
        # New path whose basename collides with any remote workflow → refuse.
        if base in remote_names or remote_by_base.get(base):
            duplicates.append(rel)
    if duplicates:
        status["ok"] = False
        status["error"] = "remote already has workflow(s) with the same name"
        status["duplicates"] = duplicates
        return status

    # Block commit while behind so we don't create a diverging tip.
    if int(status.get("behind") or 0) > 0:
        status["ok"] = False
        status["error_code"] = "need_update"
        status["error"] = "remote has new commits — click Update first, then Commit again"
        status["duplicates"] = []
        return status

    msg = (message or "").strip() or (
        f"chore: add workflow {Path(cleaned[0]).stem}"
        if len(cleaned) == 1
        else f"chore: add {len(cleaned)} workflows"
    )
    try:
        remote = status.get("remote") or "origin"
        branch = status.get("branch") or "main"
        packed = native_workflow_assets.pack_for_workflows(root, cleaned)
        add_paths = list(cleaned) + list(packed.added)
        _run_git(root, "add", "--", *add_paths)
        diff = _run_git(root, "diff", "--cached", "--quiet")
        if diff.returncode == 0:
            # Nothing new to commit — if we are ahead (e.g. previous push was rejected,
            # then user Updated/rebased), just push the existing local commit(s).
            upstream_now = _upstream_ref(root)
            ahead_now, behind_now = _ahead_behind(root, upstream_now)
            if behind_now > 0:
                status = collect_status(root, fetch_remote=False)
                status["ok"] = False
                status["error_code"] = "need_update"
                status["error"] = "remote has new commits — click Update first, then Commit again"
                status["duplicates"] = []
                return status
            if ahead_now > 0:
                p = _push_current_branch(root, remote, branch)
                if p.returncode != 0:
                    detail = (p.stderr or p.stdout or "").strip()[:500]
                    tok = _read_token(root)
                    if tok:
                        detail = detail.replace(tok, "***")
                    status = collect_status(root, fetch_remote=False)
                    status["ok"] = False
                    status["duplicates"] = []
                    if _is_non_ff_push_error(detail):
                        status["error_code"] = "need_update"
                        status["error"] = (
                            "remote has new commits — click Update first, then Commit again"
                        )
                    else:
                        status["error"] = detail or "git push failed"
                    return status
                status = collect_status(root, fetch_remote=False)
                status["pushed"] = True
                status["paths"] = cleaned
                status["duplicates"] = []
                return status

            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["error_code"] = "nothing_to_commit"
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

        p = _push_current_branch(root, remote, branch)
        if p.returncode != 0:
            detail = (p.stderr or p.stdout or "").strip()[:500]
            tok = _read_token(root)
            if tok:
                detail = detail.replace(tok, "***")
            status = collect_status(root, fetch_remote=False)
            status["ok"] = False
            status["duplicates"] = []
            if _is_non_ff_push_error(detail):
                status["error_code"] = "need_update_after_commit"
                status["error"] = (
                    "commit saved locally, but remote has newer commits — "
                    "click Update, then Commit again to finish push"
                )
            else:
                status["error"] = detail or "git push failed"
            return status

        status = collect_status(root, fetch_remote=False)
        status["pushed"] = True
        status["paths"] = cleaned
        status["duplicates"] = []
        status["assets_packed"] = packed.packed_files
        status["assets_warnings"] = packed.warnings[:40]
        return status
    except Exception as e:
        status = collect_status(root, fetch_remote=False)
        status["ok"] = False
        status["error"] = str(e) or type(e).__name__
        status["duplicates"] = []
        return status


@routes.get("/comfytv/workflows/native/git")
async def native_git_status(request: web.Request) -> web.Response:
    # Default fetch=1 so the panel can show "remote has updates".
    # Auth comes from .comfytv-git-token (no interactive login). Pass ?fetch=0 for local-only.
    raw = str(request.rel_url.query.get("fetch") or "1").lower()
    fetch = raw not in ("0", "false", "no")
    uid = resolve_request_user_id(request)
    data = await asyncio.to_thread(collect_status, None, fetch_remote=fetch, user_id=uid)
    return web.json_response(data)


@routes.post("/comfytv/workflows/native/git/setup")
async def native_git_setup(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}
    remote = str((body or {}).get("remote") or "").strip()
    uid = resolve_request_user_id(request)
    data = await asyncio.to_thread(setup_repo, remote, None, uid)
    return web.json_response(data)


@routes.post("/comfytv/workflows/native/git/pull")
async def native_git_pull(request: web.Request) -> web.Response:
    uid = resolve_request_user_id(request)
    data = await asyncio.to_thread(pull_repo, None, uid)
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
    uid = resolve_request_user_id(request)
    if isinstance(paths_raw, list) and paths_raw:
        paths = [str(p) for p in paths_raw]
        data = await asyncio.to_thread(push_paths, paths, message, None, uid)
        return web.json_response(data)
    if path:
        # legacy single-path: still refuse if remote duplicate
        data = await asyncio.to_thread(push_paths, [path], message, None, uid)
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
