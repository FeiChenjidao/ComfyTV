"""Read / pick local PSD files by absolute path — no copy into input/.

Used by the PSD Layer Tree stage so refresh can reopen the original file.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from aiohttp import web

from ._common import _log, routes

_EXT = {'.psd', '.psb'}


def _normalize_path(raw: str) -> Path | None:
    text = (raw or '').strip().strip('"')
    if not text:
        return None
    # Accept file:///D:/a.psd
    if text.lower().startswith('file:'):
        from urllib.parse import unquote, urlparse
        parsed = urlparse(text)
        text = unquote(parsed.path)
        if os.name == 'nt' and text.startswith('/') and len(text) > 2 and text[2] == ':':
            text = text[1:]
    try:
        path = Path(text).expanduser().resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    return path


def _is_psd(path: Path) -> bool:
    return path.suffix.lower() in _EXT


def _pick_windows() -> str:
    """Win32 GetOpenFileNameW — no tkinter required (embedded Python)."""
    import ctypes
    from ctypes import wintypes

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ('lStructSize', wintypes.DWORD),
            ('hwndOwner', wintypes.HWND),
            ('hInstance', wintypes.HINSTANCE),
            ('lpstrFilter', wintypes.LPCWSTR),
            ('lpstrCustomFilter', wintypes.LPWSTR),
            ('nMaxCustFilter', wintypes.DWORD),
            ('nFilterIndex', wintypes.DWORD),
            ('lpstrFile', wintypes.LPWSTR),
            ('nMaxFile', wintypes.DWORD),
            ('lpstrFileTitle', wintypes.LPWSTR),
            ('nMaxFileTitle', wintypes.DWORD),
            ('lpstrInitialDir', wintypes.LPCWSTR),
            ('lpstrTitle', wintypes.LPCWSTR),
            ('Flags', wintypes.DWORD),
            ('nFileOffset', wintypes.WORD),
            ('nFileExtension', wintypes.WORD),
            ('lpstrDefExt', wintypes.LPCWSTR),
            ('lCustData', wintypes.LPARAM),
            ('lpfnHook', wintypes.LPVOID),
            ('lpTemplateName', wintypes.LPCWSTR),
            ('pvReserved', wintypes.LPVOID),
            ('dwReserved', wintypes.DWORD),
            ('FlagsEx', wintypes.DWORD),
        ]

    OFN_FILEMUSTEXIST = 0x00001000
    OFN_PATHMUSTEXIST = 0x00000800
    OFN_EXPLORER = 0x00080000
    OFN_NOCHANGEDIR = 0x00000008
    OFN_HIDEREADONLY = 0x00000004

    buf = ctypes.create_unicode_buffer(32768)
    filt = (
        'Photoshop\0*.psd;*.psb\0'
        'PSD\0*.psd\0'
        'PSB\0*.psb\0'
        'All files\0*.*\0\0'
    )
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.lpstrFilter = filt
    ofn.nFilterIndex = 1
    ofn.lpstrFile = ctypes.cast(buf, wintypes.LPWSTR)
    ofn.nMaxFile = len(buf)
    ofn.lpstrTitle = '选择 PSD / PSB'
    ofn.lpstrDefExt = 'psd'
    ofn.Flags = (
        OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_EXPLORER
        | OFN_NOCHANGEDIR | OFN_HIDEREADONLY
    )

    comdlg = ctypes.WinDLL('comdlg32', use_last_error=True)
    ok = comdlg.GetOpenFileNameW(ctypes.byref(ofn))
    if not ok:
        err = ctypes.get_last_error()
        # 0 == user cancelled
        if err == 0:
            return ''
        raise OSError(f'GetOpenFileNameW failed (winerr={err})')
    return buf.value.strip()


def _pick_tkinter() -> str:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes('-topmost', True)
    except tk.TclError:
        pass
    try:
        return filedialog.askopenfilename(
            title='选择 PSD / PSB',
            filetypes=[
                ('Photoshop', '*.psd *.psb'),
                ('PSD', '*.psd'),
                ('PSB', '*.psb'),
                ('All files', '*.*'),
            ],
        ) or ''
    finally:
        root.destroy()


def _pick_dialog() -> str:
    if os.name == 'nt':
        return _pick_windows()
    return _pick_tkinter()


@routes.post('/comfytv/psd/pick')
async def pick_psd(_request: web.Request) -> web.Response:
    """Native OS file dialog on the ComfyUI host (same machine as the UI)."""
    try:
        chosen = await asyncio.to_thread(_pick_dialog)
    except Exception as e:
        _log.exception('[ComfyTV/psd] native pick failed')
        return web.json_response({'ok': False, 'error': str(e)}, status=500)

    if not chosen:
        return web.json_response({'ok': False, 'cancelled': True})

    path = _normalize_path(chosen)
    if path is None or not path.is_file() or not _is_psd(path):
        return web.json_response({'ok': False, 'error': 'invalid psd path'}, status=400)

    return web.json_response({
        'ok': True,
        'path': str(path),
        'name': path.name,
    })


@routes.get('/comfytv/psd/local')
async def read_psd_local(request: web.Request) -> web.Response:
    """Stream a local PSD/PSB by absolute path. 404 when missing."""
    raw = request.rel_url.query.get('path', '')
    path = _normalize_path(raw)
    if path is None or not _is_psd(path):
        return web.json_response(
            {'error': 'invalid', 'message': 'invalid psd path'}, status=400,
        )
    if not path.is_file():
        return web.json_response(
            {'error': 'missing', 'message': 'path psd missing', 'path': str(path)},
            status=404,
        )
    try:
        return web.FileResponse(
            path,
            headers={
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': f'inline; filename="{path.name}"',
            },
        )
    except OSError as e:
        _log.exception('[ComfyTV/psd] read failed: %s', path)
        return web.json_response({'error': 'read', 'message': str(e)}, status=500)
