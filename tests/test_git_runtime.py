from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("git_runtime_test", Path(__file__).resolve().parents[1] / "git_runtime.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "_CONFIG_PATH", tmp_path / "git-path")
    monkeypatch.setenv("PATH", os.environ.get("PATH", ""))
    monkeypatch.setattr(mod, "_add_windows_user_path", Mock())
    return mod


def executable(tmp_path):
    path = tmp_path / "Git 中文 with spaces" / "cmd" / ("git.exe" if os.name == "nt" else "git")
    path.parent.mkdir(parents=True)
    path.touch()
    return path


def test_validates_a_real_git_installation(runtime):
    git = shutil.which("git")
    if not git:
        pytest.skip("Git not installed")
    result = runtime.configure_git(git)
    assert result["ok"]
    assert result["version"].startswith("git version ")
    assert runtime.git_bin() == git


def test_accepts_quoted_executable_and_restores_after_restart(runtime, tmp_path, monkeypatch):
    git = executable(tmp_path)
    run = Mock(return_value=subprocess.CompletedProcess([], 0, "git version 2.47.0\n", ""))
    monkeypatch.setattr(runtime.subprocess, "run", run)
    monkeypatch.setenv("PATH", "original")

    result = runtime.configure_git(f'"{git}"')

    assert result["ok"]
    assert result["version"] == "git version 2.47.0"
    assert run.call_args.args[0] == [str(git), "--version"]
    assert os.environ["PATH"] == str(git.parent) + os.pathsep + "original"
    assert runtime._CONFIG_PATH.read_text(encoding="utf-8").strip() == str(git)
    monkeypatch.setenv("PATH", "launcher-replaced-path")
    assert runtime.git_bin() == str(git)
    assert os.environ["PATH"].startswith(str(git.parent) + os.pathsep)


def test_accepts_install_directory_and_does_not_duplicate_path(runtime, tmp_path, monkeypatch):
    git = executable(tmp_path)
    monkeypatch.setattr(runtime.subprocess, "run", Mock(return_value=subprocess.CompletedProcess([], 0, "git version 2.47.0", "")))
    monkeypatch.setenv("PATH", str(git.parent))
    for folder in (git.parent, git.parent.parent):
        assert runtime.configure_git(str(folder))["ok"]
    assert os.environ["PATH"] == str(git.parent)


@pytest.mark.parametrize("text", ["", "relative/git.exe", "C:/does-not-exist/git.exe"])
def test_invalid_path_does_not_change_environment_or_config(runtime, text, monkeypatch):
    run = Mock()
    monkeypatch.setattr(runtime.subprocess, "run", run)
    previous = os.environ["PATH"]
    assert not runtime.configure_git(text)["ok"]
    assert os.environ["PATH"] == previous
    assert not runtime._CONFIG_PATH.exists()
    run.assert_not_called()


@pytest.mark.parametrize("failure", [
    subprocess.CompletedProcess([], 1, "", "broken"),
    subprocess.CompletedProcess([], 0, "not git", ""),
    subprocess.TimeoutExpired("git", 5),
    OSError("not executable"),
])
def test_failed_validation_preserves_previous_config(runtime, tmp_path, monkeypatch, failure):
    git = executable(tmp_path)
    runtime._CONFIG_PATH.write_text("previous-location", encoding="utf-8")
    run = Mock(side_effect=failure) if isinstance(failure, Exception) else Mock(return_value=failure)
    monkeypatch.setattr(runtime.subprocess, "run", run)
    previous = os.environ["PATH"]
    assert not runtime.configure_git(str(git))["ok"]
    assert runtime._CONFIG_PATH.read_text(encoding="utf-8") == "previous-location"
    assert os.environ["PATH"] == previous


def test_missing_saved_git_falls_back_to_path(runtime, monkeypatch):
    runtime._CONFIG_PATH.write_text("/removed/git", encoding="utf-8")
    monkeypatch.setattr(runtime.shutil, "which", lambda name: "/available/git")
    assert runtime.git_bin() == "/available/git"


@pytest.mark.skipif(os.name != "nt", reason="Windows user environment")
def test_registry_failure_still_enables_comfyui(runtime, tmp_path, monkeypatch):
    git = executable(tmp_path)
    monkeypatch.setattr(runtime.subprocess, "run", Mock(return_value=subprocess.CompletedProcess([], 0, "git version 2.47.0", "")))
    runtime._add_windows_user_path.side_effect = PermissionError("registry denied")
    result = runtime.configure_git(str(git))
    assert result["ok"]
    assert not result["user_path_added"]
    assert "registry denied" in result["warning"]
    assert runtime.git_bin() == str(git)


@pytest.mark.skipif(os.name != "nt", reason="Windows user environment")
@pytest.mark.parametrize("existing", [False, True])
def test_windows_user_path_preserves_variables_and_type(tmp_path, monkeypatch, existing):
    spec = importlib.util.spec_from_file_location("git_runtime_registry_test", Path(__file__).resolve().parents[1] / "git_runtime.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    directory = str(tmp_path / "Git" / "cmd")
    current = r"%USERPROFILE%\tools;C:\other"
    if existing:
        current += ";" + directory.upper()
    key = Mock()
    key.__enter__ = Mock(return_value=key)
    key.__exit__ = Mock(return_value=False)
    registry = SimpleNamespace(
        HKEY_CURRENT_USER=1, KEY_READ=2, KEY_WRITE=4, REG_EXPAND_SZ=2,
        CreateKeyEx=Mock(return_value=key), QueryValueEx=Mock(return_value=(current, 2)), SetValueEx=Mock(),
    )
    broadcast = Mock()
    monkeypatch.setattr(mod, "winreg", registry)
    monkeypatch.setattr(mod, "ctypes", SimpleNamespace(
        c_size_t=Mock(), c_wchar_p=lambda s: s, byref=lambda v: v,
        windll=SimpleNamespace(user32=SimpleNamespace(SendMessageTimeoutW=broadcast)),
    ))

    mod._add_windows_user_path(directory)

    if existing:
        registry.SetValueEx.assert_not_called()
    else:
        registry.SetValueEx.assert_called_once_with(key, "Path", 0, 2, current + ";" + directory)
    broadcast.assert_called_once()
