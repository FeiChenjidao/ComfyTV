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
    link._native_workflows_dir = lambda: None

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

        # a.json already on remote from init
        out = mod.push_paths(["a.json"], "dup", root=root)
        assert out["ok"] is False
        assert "a.json" in (out.get("duplicates") or [])

        (root / "b.json").write_text('{"nodes":[]}', encoding="utf-8")
        out2 = mod.push_paths(["b.json"], "feat: add b", root=root)
        assert out2["ok"] is True
        assert out2.get("pushed") is True
        assert out2.get("paths") == ["b.json"]
