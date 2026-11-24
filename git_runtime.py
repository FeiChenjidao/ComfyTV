"""Manual Git location shared by workflow sync and plugin updates."""
from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Optional

if os.name == "nt":
    import winreg

_CONFIG_PATH = Path(__file__).resolve().parent / "comfytv.git-path"
_CONFIG_LOCK = threading.Lock()


def _prepend_path(directory: str) -> None:
    current = os.environ.get("PATH", "")
    entries = current.split(os.pathsep) if current else []
    normalized = os.path.normcase(os.path.normpath(directory))
    entries = [p for p in entries if os.path.normcase(os.path.normpath(p.strip('"'))) != normalized]
    os.environ["PATH"] = os.pathsep.join([directory, *entries])


def git_bin() -> Optional[str]:
    with _CONFIG_LOCK:
        try:
            saved = Path(_CONFIG_PATH.read_text(encoding="utf-8").strip())
            if saved.is_absolute() and saved.is_file():
                _prepend_path(str(saved.parent))
                return str(saved)
        except (OSError, ValueError):
            pass
    return shutil.which("git")


def _add_windows_user_path(directory: str) -> None:
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
        try:
            current, kind = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            current, kind = "", winreg.REG_EXPAND_SZ
        entries = current.split(";") if current else []
        normalized = os.path.normcase(os.path.normpath(directory))
        if not any(
            os.path.normcase(os.path.normpath(os.path.expandvars(p.strip().strip('"')))) == normalized
            for p in entries if p.strip()
        ):
            value = current + (";" if current and not current.endswith(";") else "") + directory
            winreg.SetValueEx(key, "Path", 0, kind, value)
    result = ctypes.c_size_t()
    ctypes.windll.user32.SendMessageTimeoutW(
        0xFFFF, 0x001A, 0, ctypes.c_wchar_p("Environment"), 0x0002, 1000, ctypes.byref(result),
    )


def configure_git(raw_path: str) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": False, "path": "", "version": "", "user_path_added": False, "error": ""}
    text = raw_path.strip().strip('"').strip("'")
    if not text:
        return {**payload, "error": "Enter the absolute path to git.exe or its installation folder."}
    candidate = Path(text).expanduser()
    if not candidate.is_absolute():
        return {**payload, "error": "Git path must be absolute."}
    if candidate.is_dir():
        name = "git.exe" if os.name == "nt" else "git"
        candidate = next(
            (p for p in (candidate / name, candidate / "cmd" / name, candidate / "bin" / name) if p.is_file()),
            candidate / name,
        )
    if candidate.name.lower() not in ("git", "git.exe") or not candidate.is_file():
        return {**payload, "error": "Git executable not found at this path."}
    try:
        result = subprocess.run(
            [str(candidate), "--version"], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {**payload, "error": f"Cannot run Git: {error}"}
    version = result.stdout.strip()
    if result.returncode != 0 or not version.startswith("git version "):
        return {**payload, "error": "This executable did not return a valid Git version."}
    with _CONFIG_LOCK:
        try:
            temp = _CONFIG_PATH.with_name(_CONFIG_PATH.name + ".tmp")
            temp.write_text(str(candidate) + "\n", encoding="utf-8")
            temp.replace(_CONFIG_PATH)
        except OSError as error:
            return {**payload, "error": f"Cannot save Git path: {error}"}
        _prepend_path(str(candidate.parent))
        if os.name == "nt":
            try:
                _add_windows_user_path(str(candidate.parent))
                payload["user_path_added"] = True
            except OSError as error:
                payload["warning"] = str(error)
    return {**payload, "ok": True, "path": str(candidate), "version": version}
