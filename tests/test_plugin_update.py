from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
from pathlib import Path

import pytest


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )


def _load_mod():
    root = Path(__file__).resolve().parents[1]
    pkg = "ComfyTV"
    if pkg not in sys.modules:
        m = types.ModuleType(pkg)
        m.__path__ = [str(root)]
        sys.modules[pkg] = m

    for name in ("ComfyTV.api",):
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)

    common = types.ModuleType("ComfyTV.api._common")

    class _Routes:
        def get(self, _path):
            return lambda fn: fn

        def post(self, _path):
            return lambda fn: fn

    common.routes = _Routes()
    sys.modules["ComfyTV.api._common"] = common

    caps = types.ModuleType("ComfyTV.api.capabilities")
    caps.VERSION = "9.9.9"
    sys.modules["ComfyTV.api.capabilities"] = caps

    path = root / "api" / "plugin_update.py"
    spec = importlib.util.spec_from_file_location("ComfyTV.api.plugin_update", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ComfyTV.api.plugin_update"] = mod
    spec.loader.exec_module(mod)
    return mod


def _init_repo(path: Path, version: str = "1.0.0") -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / "pyproject.toml").write_text(
        f'[project]\nname = "ComfyTV"\nversion = "{version}"\n',
        encoding="utf-8",
    )
    _git(path, "init")
    _git(path, "config", "user.email", "test@example.com")
    _git(path, "config", "user.name", "Test")
    _git(path, "add", "pyproject.toml")
    _git(path, "commit", "-m", "init")
    _git(path, "branch", "-M", "main")


@pytest.fixture()
def twin_repos(tmp_path: Path):
    remote = tmp_path / "remote.git"
    _git(tmp_path, "init", "--bare", str(remote))

    local = tmp_path / "local"
    _init_repo(local, "1.0.0")
    _git(local, "remote", "add", "origin", str(remote))
    _git(local, "push", "-u", "origin", "main")

    other = tmp_path / "other"
    _git(tmp_path, "clone", str(remote), str(other))
    _git(other, "config", "user.email", "test@example.com")
    _git(other, "config", "user.name", "Test")
    # Windows git may leave the clone on a non-main local name; force tracking.
    _git(other, "checkout", "-B", "main", "origin/main")
    return local, other, remote


class TestPluginUpdateCheck:
    def test_detects_behind(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "1.1.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "bump")
        _git(other, "push", "origin", "main")

        status = mod.check_plugin_update(fetch=True, root=local)
        assert status["ok"] is True
        assert status["is_repo"] is True
        assert status["update_available"] is True
        assert status["behind"] == 1
        assert status["local_version"] == "1.0.0"
        assert status["remote_version"] == "1.1.0"

    def test_up_to_date(self, twin_repos):
        mod = _load_mod()
        local, _other, _remote = twin_repos
        status = mod.check_plugin_update(fetch=True, root=local)
        assert status["ok"] is True
        assert status["update_available"] is False
        assert status["behind"] == 0

    def test_apply_ff_only(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "2.0.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "bump2")
        _git(other, "push", "origin", "main")

        before = mod.check_plugin_update(fetch=True, root=local)
        assert before["update_available"] is True

        after = mod.apply_plugin_update(root=local)
        assert after["ok"] is True
        assert after["restart_required"] is True
        assert after["update_available"] is False
        assert after["behind"] == 0
        assert "2.0.0" in (local / "pyproject.toml").read_text(encoding="utf-8")

    def test_refuse_dirty(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "1.2.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "bump")
        _git(other, "push", "origin", "main")

        (local / "dirty.txt").write_text("x", encoding="utf-8")
        status = mod.apply_plugin_update(root=local)
        assert status["ok"] is False
        assert status["error_code"] == "dirty"
