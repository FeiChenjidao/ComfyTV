from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def restore_import_stubs():
    names = [
        "ComfyTV", "ComfyTV.api", "ComfyTV.api._common",
        "ComfyTV.api.capabilities", "ComfyTV.api.plugin_update",
    ]
    previous = {name: sys.modules.get(name) for name in names}
    attributes = {name: dict(module.__dict__) for name, module in previous.items() if module is not None}
    yield
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
            module.__dict__.clear()
            module.__dict__.update(attributes[name])


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

    def test_untracked_files_do_not_offer_repair(self, twin_repos):
        mod = _load_mod()
        local, _other, _remote = twin_repos
        (local / "local-only.txt").write_text("keep", encoding="utf-8")

        status = mod.check_plugin_update(fetch=True, root=local)

        assert status["dirty"] is False
        assert status["repair_available"] is False

    def test_apply_ff_only(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        rescans = []
        mod._rescan_workflows_after_update = lambda: rescans.append(True) or {
            "added": [], "pruned": 1, "total": 1,
        }
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
        assert rescans == [True]
        assert after["workflow_rescan"]["pruned"] == 1

    def test_force_overwrites_dirty(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "1.2.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "bump")
        _git(other, "push", "origin", "main")

        (local / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "9.9.9-local"\n',
            encoding="utf-8",
        )
        (local / "dirty.txt").write_text("keep-untracked", encoding="utf-8")
        status = mod.apply_plugin_update(root=local)
        assert status["ok"] is True
        assert status["forced"] is True
        assert status["behind"] == 0
        assert "1.2.0" in (local / "pyproject.toml").read_text(encoding="utf-8")
        # Untracked files are not deleted by the force reset.
        assert (local / "dirty.txt").read_text(encoding="utf-8") == "keep-untracked"

    def test_force_overwrites_builtin_workflow_and_keeps_user_workflow(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        workflow_dir = local / "workflows" / "image"
        workflow_dir.mkdir(parents=True)
        (local / "workflows" / ".gitignore").write_text(
            "*.json\n!image/\n!image/builtin.json\n",
            encoding="utf-8",
        )
        builtin = workflow_dir / "builtin.json"
        builtin.write_text('{"version": "shipped-v1"}\n', encoding="utf-8")
        _git(local, "add", "workflows/.gitignore", "workflows/image/builtin.json")
        _git(local, "commit", "-m", "add built-in workflow")
        _git(local, "push", "origin", "main")

        _git(other, "pull", "--ff-only", "origin", "main")
        remote_builtin = other / "workflows" / "image" / "builtin.json"
        remote_builtin.write_text('{"version": "shipped-v2"}\n', encoding="utf-8")
        _git(other, "add", "workflows/image/builtin.json")
        _git(other, "commit", "-m", "update built-in workflow")
        _git(other, "push", "origin", "main")

        builtin.write_text('{"version": "local-edit"}\n', encoding="utf-8")
        user_workflow = local / "workflows" / "user-custom.json"
        user_workflow.write_text('{"version": "user"}\n', encoding="utf-8")

        status = mod.apply_plugin_update(root=local)

        assert status["ok"] is True
        assert status["forced"] is True
        assert builtin.read_text(encoding="utf-8") == '{"version": "shipped-v2"}\n'
        assert user_workflow.read_text(encoding="utf-8") == '{"version": "user"}\n'

    def test_fetch_failure_never_uses_a_stale_remote_tip(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "1.3.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "bump")
        _git(other, "push", "origin", "main")
        assert mod.check_plugin_update(fetch=True, root=local)["update_available"] is True

        _git(local, "remote", "set-url", "origin", str(local / "missing-remote.git"))
        status = mod.check_plugin_update(fetch=True, root=local)

        assert status["ok"] is False
        assert status["update_available"] is False
        assert status["error_code"] == "fetch_failed"

    def test_quarantines_user_file_when_remote_adds_same_path(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        workflows = local / "workflows"
        workflows.mkdir()
        (workflows / ".gitignore").write_text("*.json\n", encoding="utf-8")
        _git(local, "add", "workflows/.gitignore")
        _git(local, "commit", "-m", "ignore user workflows")
        _git(local, "push", "origin", "main")
        _git(other, "pull", "--ff-only", "origin", "main")

        user_workflow = workflows / "model" / "new-builtin.json"
        user_workflow.parent.mkdir()
        user_workflow.write_text('{"source": "user"}\n', encoding="utf-8")
        remote_workflow = other / "workflows" / "model" / "new-builtin.json"
        remote_workflow.parent.mkdir(parents=True)
        remote_workflow.write_text('{"source": "remote"}\n', encoding="utf-8")
        _git(other, "add", "-f", "workflows/model/new-builtin.json")
        _git(other, "commit", "-m", "ship workflow")
        _git(other, "push", "origin", "main")

        status = mod.apply_plugin_update(root=local)

        backup = Path(str(user_workflow) + ".local-backup")
        assert status["ok"] is True
        assert user_workflow.read_text(encoding="utf-8") == '{"source": "remote"}\n'
        assert backup.read_text(encoding="utf-8") == '{"source": "user"}\n'
        assert "workflows/model/new-builtin.json.local-backup" in status["local_backups"]

    def test_quarantines_independently_tracked_workflow_collision(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        local_workflow = local / "workflows" / "model" / "shared.json"
        local_workflow.parent.mkdir(parents=True)
        local_workflow.write_text('{"source": "local-commit"}\n', encoding="utf-8")
        _git(local, "add", "workflows/model/shared.json")
        _git(local, "commit", "-m", "local workflow")

        remote_workflow = other / "workflows" / "model" / "shared.json"
        remote_workflow.parent.mkdir(parents=True)
        remote_workflow.write_text('{"source": "remote-built-in"}\n', encoding="utf-8")
        _git(other, "add", "workflows/model/shared.json")
        _git(other, "commit", "-m", "remote workflow")
        _git(other, "push", "origin", "main")

        status = mod.apply_plugin_update(root=local)

        backup = Path(str(local_workflow) + ".local-backup")
        assert status["ok"] is True
        assert local_workflow.read_text(encoding="utf-8") == '{"source": "remote-built-in"}\n'
        assert backup.read_text(encoding="utf-8") == '{"source": "local-commit"}\n'

    def test_restores_tracked_local_only_workflow_after_force_update(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        local_workflow = local / "workflows" / "mine.json"
        local_workflow.parent.mkdir()
        local_workflow.write_text('{"source": "local"}\n', encoding="utf-8")
        _git(local, "add", "workflows/mine.json")
        _git(local, "commit", "-m", "local workflow")

        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "1.4.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "remote update")
        _git(other, "push", "origin", "main")

        status = mod.apply_plugin_update(root=local)

        assert status["ok"] is True
        assert status["forced"] is True
        assert local_workflow.read_text(encoding="utf-8") == '{"source": "local"}\n'
        assert _git(local, "ls-files", "workflows/mine.json").stdout.strip() == ""

    def test_update_creates_patch_and_can_rollback(self, twin_repos):
        mod = _load_mod()
        local, other, _remote = twin_repos
        (other / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "2.0.0"\n',
            encoding="utf-8",
        )
        _git(other, "add", "pyproject.toml")
        _git(other, "commit", "-m", "major update")
        _git(other, "push", "origin", "main")
        (local / "pyproject.toml").write_text(
            '[project]\nname = "ComfyTV"\nversion = "9.9.9-local"\n',
            encoding="utf-8",
        )

        updated = mod.apply_plugin_update(root=local)

        patch = Path(updated["backup_path"]) / "tracked-changes.patch"
        assert updated["ok"] is True
        assert updated["rollback_available"] is True
        assert updated["rollback_version"] == "1.0.0"
        assert updated["dependency_files_changed"] == []
        assert "9.9.9-local" in patch.read_text(encoding="utf-8")
        assert "2.0.0" in (local / "pyproject.toml").read_text(encoding="utf-8")

        rolled_back = mod.rollback_plugin_update(root=local)

        assert rolled_back["ok"] is True
        assert rolled_back["rolled_back"] is True
        assert rolled_back["rollback_available"] is False
        assert rolled_back["restart_required"] is True
        assert "1.0.0" in (local / "pyproject.toml").read_text(encoding="utf-8")

    def test_rejects_concurrent_update(self, twin_repos):
        mod = _load_mod()
        local, _other, _remote = twin_repos
        assert mod._UPDATE_LOCK.acquire(blocking=False)
        try:
            status = mod.apply_plugin_update(root=local)
        finally:
            mod._UPDATE_LOCK.release()

        assert status["ok"] is False
        assert status["update_in_progress"] is True
        assert status["error_code"] == "update_in_progress"
