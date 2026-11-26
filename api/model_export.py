import asyncio

from aiohttp import web
from urllib.parse import quote

from ._common import _log, routes
from ..runners.model_export import export_source_model


@routes.get("/comfytv/model/export_source")
async def export_source(request: web.Request) -> web.Response:
    try:
        data, filename, content_type = await asyncio.to_thread(
            export_source_model, str(request.query.get('url') or ''),
            str(request.query.get('format') or '').lower())
    except FileNotFoundError as error:
        return web.json_response({'error': str(error)}, status=404)
    except ValueError as error:
        return web.json_response({'error': str(error)}, status=400)
    except Exception as error:
        _log.exception('[ComfyTV/model] source polygon export failed')
        return web.json_response({'error': str(error)}, status=500)
    return web.Response(body=data, headers={
        'Content-Type': content_type,
        'Content-Disposition': f"attachment; filename*=UTF-8''{quote(filename)}",
        'Cache-Control': 'no-store',
    })


@routes.get("/comfytv/model/export_obj_zip")
async def export_obj_zip(request: web.Request) -> web.Response:
    """Convert a model view URL to OBJ + MTL + textures, returned as a zip download."""
    url = str(request.query.get("url") or "").strip()
    if not url:
        return web.json_response({"error": "url is required"}, status=400)
    stem = str(request.query.get("stem") or "").strip() or None

    from ..runners.geometry import export_model_obj_zip

    try:
        data, filename = await asyncio.get_running_loop().run_in_executor(
            None, export_model_obj_zip, url, stem)
    except FileNotFoundError:
        return web.json_response({"error": "model not found"}, status=404)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    except Exception as e:
        _log.exception("[ComfyTV/model] export_obj_zip failed for %s", url)
        return web.json_response({"error": str(e)}, status=500)

    return web.Response(
        body=data,
        headers={
            "Content-Type": "application/zip",
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
