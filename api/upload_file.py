"""Raw file upload into ComfyUI input/ for non-image stage assets (PSD, etc.).

``/upload/image`` can fail for large / non-image files once asset registration
runs; this path only writes bytes under ``input/comfytv/...`` and returns a
``/view`` URL so widgets can persist across refresh.
"""
from __future__ import annotations

import re
import urllib.parse
from pathlib import Path

from aiohttp import web

from ._common import _log, routes

# Keep under comfytv/ so we never write outside the plugin input namespace.
_ALLOWED_SUBFOLDERS = {
    'comfytv/psd': {'.psd', '.psb'},
}
_MAX_BYTES = 1024 * 1024 * 1024  # 1 GiB
_SAFE_NAME = re.compile(r'^[\w][\w .()\-一-鿿]*$')


def _input_dir() -> Path:
    import folder_paths
    return Path(folder_paths.get_input_directory())


def _view_url(filename: str, subfolder: str) -> str:
    qs = urllib.parse.urlencode({
        'filename': filename, 'subfolder': subfolder, 'type': 'input',
    })
    return f'/view?{qs}'


@routes.post('/comfytv/upload')
async def upload_file(request: web.Request) -> web.Response:
    try:
        reader = await request.multipart()
    except (AssertionError, ValueError) as e:
        return web.json_response({'error': f'expected multipart body: {e}'}, status=400)

    subfolder = ''
    field = None
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == 'subfolder':
            subfolder = (await part.text()).strip().replace('\\', '/')
        elif part.name == 'file':
            field = part
            break

    if field is None:
        return web.json_response({'error': "expected multipart field 'file'"}, status=400)

    allowed_exts = _ALLOWED_SUBFOLDERS.get(subfolder)
    if allowed_exts is None:
        return web.json_response({
            'error': f'subfolder must be one of {sorted(_ALLOWED_SUBFOLDERS)}',
        }, status=400)

    name = (field.filename or '').strip()
    base = Path(name).name
    suffix = Path(base).suffix.lower()
    if not base or not _SAFE_NAME.match(base):
        return web.json_response({'error': 'bad file name'}, status=400)
    if suffix not in allowed_exts:
        return web.json_response({
            'error': f'unsupported type {suffix!r} (use {"/".join(sorted(allowed_exts))})',
        }, status=400)

    dest_dir = _input_dir() / subfolder
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / base
    stem, ext = Path(base).stem, Path(base).suffix
    n = 1
    while dest.exists():
        dest = dest_dir / f'{stem}-{n}{ext}'
        n += 1

    size = 0
    try:
        with open(dest, 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_BYTES:
                    f.close()
                    dest.unlink(missing_ok=True)
                    return web.json_response({'error': 'file too large (>1GB)'}, status=400)
                f.write(chunk)
    except OSError as e:
        dest.unlink(missing_ok=True)
        _log.exception('[ComfyTV/upload] write failed')
        return web.json_response({'error': f'write failed: {e}'}, status=500)

    _log.info('[ComfyTV/upload] saved %s/%s (%d bytes)', subfolder, dest.name, size)
    return web.json_response({
        'ok': True,
        'name': dest.name,
        'subfolder': subfolder,
        'type': 'input',
        'url': _view_url(dest.name, subfolder),
        'size': size,
    })
