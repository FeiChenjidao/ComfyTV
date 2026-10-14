from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
from pathlib import Path


def _load_mod():
    root = Path(__file__).resolve().parents[1]
    pkg = "ComfyTV"
    if pkg not in sys.modules:
        m = types.ModuleType(pkg)
        m.__path__ = [str(root)]
        sys.modules[pkg] = m
    for name in (
        "ComfyTV.api",
        "ComfyTV.runners",
        "ComfyTV.runners.workflow_db",
        "ComfyTV.runners.workflow_db.link",
    ):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)

    link = sys.modules["ComfyTV.runners.workflow_db.link"]
    link._native_workflows_dir = lambda *_a, **_k: None
    link.resolve_request_user_id = lambda *_a, **_k: "default"

    common = types.ModuleType("ComfyTV.api._common")

    class _Routes:
        def get(self, _path):
            return lambda fn: fn

        def post(self, _path):
            return lambda fn: fn

    common.routes = _Routes()
    sys.modules["ComfyTV.api._common"] = common

    path = root / "api" / "native_workflow_git.py"
    spec = importlib.util.spec_from_file_location(
        "ComfyTV.api.native_workflow_git", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ComfyTV.api.native_workflow_git"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args], cwd=str(cwd), check=True,
        capture_output=True, text=True,
    )


def _init_repo(tmp: Path) -> Path:
    root = tmp / "workflows"
    root.mkdir()
    _git(root, "init")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "a.json").write_text('{"nodes":[]}', encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "init")
    return root


class TestNativeWorkflowGit:
    def test_ignores_parent_comfyui_repo(self, tmp_path):
        """Subfolder of another git repo must NOT count as workflows library."""
        mod = _load_mod()
        parent = tmp_path / "ComfyUI"
        parent.mkdir()
        _git(parent, "init")
        _git(parent, "config", "user.email", "test@example.com")
        _git(parent, "config", "user.name", "Test")
        (parent / "readme").write_text("x", encoding="utf-8")
        _git(parent, "add", "-A")
        _git(parent, "commit", "-m", "parent")
        nested = parent / "user" / "default" / "workflows"
        nested.mkdir(parents=True)
        (nested / "a.json").write_text('{"nodes":[]}', encoding="utf-8")
        st = mod.collect_status(nested, fetch_remote=False)
        assert st["is_repo"] is False

    def test_status_not_repo(self, tmp_path):
        mod = _load_mod()
        empty = tmp_path / "empty"
        empty.mkdir()
        st = mod.collect_status(empty, fetch_remote=False)
        assert st["is_repo"] is False
        assert st["ok"] is True

    def test_push_paths_rejects_duplicate_name(self, tmp_path):
        mod = _load_mod()
        root = _init_repo(tmp_path)

        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(root, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(root, "push", "-u", "origin", branch)

        # Same path already on remote → allowed as an update
        (root / "a.json").write_text('{"nodes":[1]}', encoding="utf-8")
        out_upd = mod.push_paths(["a.json"], "chore: edit a", root=root)
        assert out_upd["ok"] is True

        # New path with same basename as remote (team/a.json vs a.json) → refuse
        team = root / "team"
        team.mkdir()
        (team / "a.json").write_text('{"nodes":[]}', encoding="utf-8")
        out = mod.push_paths(["team/a.json"], "dup", root=root)
        assert out["ok"] is False
        assert "team/a.json" in (out.get("duplicates") or [])

        (root / "b.json").write_text('{"nodes":[]}', encoding="utf-8")
        out2 = mod.push_paths(["b.json"], "feat: add b", root=root)
        assert out2["ok"] is True
        assert out2.get("pushed") is True
        assert out2.get("paths") == ["b.json"]

    def test_setup_repo_clones_into_existing_dir(self, tmp_path):
        mod = _load_mod()
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))

        seed = tmp_path / "seed"
        seed.mkdir()
        _git(seed, "init")
        _git(seed, "config", "user.email", "test@example.com")
        _git(seed, "config", "user.name", "Test")
        (seed / "team.json").write_text('{"nodes":[]}', encoding="utf-8")
        _git(seed, "add", "-A")
        _git(seed, "commit", "-m", "seed")
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(seed), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(seed, "remote", "add", "origin", str(remote))
        _git(seed, "push", "-u", "origin", branch)

        target = tmp_path / "workflows"
        target.mkdir()
        (target / "local-only.json").write_text('{"nodes":[1]}', encoding="utf-8")
        out = mod.setup_repo(str(remote), root=target)
        assert out["ok"] is True
        assert out["is_repo"] is True
        assert (target / "team.json").is_file()
        assert (target / "local-only.json").read_text(encoding="utf-8") == '{"nodes":[1]}'

    def test_strip_auth_from_remote_url(self):
        mod = _load_mod()
        clean, tok = mod._split_auth(
            "https://x-access-token:secretPAT@github.com/org/repo.git"
        )
        assert clean == "https://github.com/org/repo.git"
        assert tok == "secretPAT"
        assert mod._strip_auth(clean) == clean

    def test_push_blocked_when_behind(self, tmp_path):
        mod = _load_mod()
        root = _init_repo(tmp_path)
        remote = tmp_path / "remote.git"
        _git(tmp_path, "init", "--bare", str(remote))
        _git(root, "remote", "add", "origin", str(remote))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(root), capture_output=True, text=True, check=True,
        ).stdout.strip()
        _git(root, "push", "-u", "origin", branch)

        other = tmp_path / "other"
        _git(tmp_path, "clone", str(remote), str(other))
        _git(other, "config", "user.email", "test@example.com")
        _git(other, "config", "user.name", "Test")
        (other / "remote-only.json").write_text('{"nodes":[]}', encoding="utf-8")
        _git(other, "add", "-A")
        _git(other, "commit", "-m", "remote ahead")
        _git(other, "push")

        (root / "local-new.json").write_text('{"nodes":[]}', encoding="utf-8")
        out = mod.push_paths(["local-new.json"], "feat: local", root=root)
        assert out["ok"] is False
        assert out.get("error_code") == "need_update"

    def test_file_states_new_and_modified(self, tmp_path):
        mod = _load_mod()
        root = _init_repo(tmp_path)
        (root / "a.json").write_text('{"nodes":[1]}', encoding="utf-8")
        (root / "newbie.json").write_text('{"nodes":[]}', encoding="utf-8")
        st = mod.collect_status(root, fetch_remote=False)
        by = {f["path"]: f for f in st["files"]}
        assert by["newbie.json"]["untracked"] is True
        assert by["newbie.json"]["state"] == "new"
        assert by["a.json"]["dirty"] is True
        assert by["a.json"]["untracked"] is False
        assert by["a.json"]["state"] == "modified"
        # Local edits alone must NOT look like "Update available"
        assert by["a.json"]["remote_diff"] is False

    def test_ensure_workflow_credentials_seeds_from_plugin(self, tmp_path, monkeypatch):
        mod = _load_mod()
        secrets = tmp_path / "plugin" / "secrets"
        secrets.mkdir(parents=True)
        (secrets / "comfytv-git-token").write_text("seed-token-value\n", encoding="utf-8")
        (secrets / "comfytv-git-remote").write_text(
            "https://github.com/example/team.git\n", encoding="utf-8",
        )
        monkeypatch.setattr(mod, "_plugin_root", lambda: tmp_path / "plugin")
        wf = tmp_path / "workflows"
        mod._ensure_workflow_credentials(wf)
        assert (wf / ".comfytv-git-token").read_text(encoding="utf-8").strip() == "seed-token-value"
        assert "example/team" in (wf / ".comfytv-git-remote").read_text(encoding="utf-8")
        # never overwrite existing
        (wf / ".comfytv-git-token").write_text("keep-me\n", encoding="utf-8")
        mod._ensure_workflow_credentials(wf)
        assert (wf / ".comfytv-git-token").read_text(encoding="utf-8").strip() == "keep-me"
