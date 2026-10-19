import asyncio

from aiohttp import web

from ._common import _log, routes


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
