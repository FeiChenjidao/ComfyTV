from __future__ import annotations

import base64
import binascii
import ipaddress
import logging
import math
import os
import struct
import time
import uuid
from io import BytesIO

from aiohttp import web
import folder_paths
from PIL import Image
from server import PromptServer

from ._common import routes


_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Original artwork layers can be large; keep a bounded local upload budget.
_MAX_IMAGE_BYTES = 256 * 1024 * 1024
_MAX_IMAGE_EDGE = 32_768
_MAX_IMAGE_PIXELS = 268_435_456
_SUBFOLDER = "comfytv/photoshop"
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}
_log = logging.getLogger(__name__)


def _is_loopback(remote: str | None) -> bool:
    if not remote:
        return False
    try:
        address = ipaddress.ip_address(remote.split("%", 1)[0])
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            return address.ipv4_mapped.is_loopback
        return address.is_loopback
    except ValueError:
        return False


def _decode_png(encoded: object) -> tuple[bytes, int, int]:
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("image_base64 is required")
    if len(encoded) > ((_MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise ValueError("image is too large")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image_base64 is invalid") from exc
    if len(data) > _MAX_IMAGE_BYTES:
        raise ValueError("image is too large")
    if len(data) < 24 or not data.startswith(_PNG_SIGNATURE) or data[12:16] != b"IHDR":
        raise ValueError("only PNG images are accepted")
    width, height = struct.unpack(">II", data[16:24])
    if (
        width == 0 or height == 0
        or width > _MAX_IMAGE_EDGE or height > _MAX_IMAGE_EDGE
        or width * height > _MAX_IMAGE_PIXELS
    ):
        raise ValueError("image dimensions are invalid")
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format != "PNG" or image.size != (width, height):
                raise ValueError("only PNG images are accepted")
            image.verify()
    except (OSError, SyntaxError) as exc:
        raise ValueError("PNG image is corrupt") from exc
    return data, width, height


def _short_text(value: object, limit: int = 200) -> str:
    return str(value or "").strip()[:limit]


def _image_bounds(value: object, name: str) -> tuple[int, int, int, int]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} is invalid")
    try:
        left = math.floor(float(value["left"]))
        top = math.floor(float(value["top"]))
        right = math.ceil(float(value["right"]))
        bottom = math.ceil(float(value["bottom"]))
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} is invalid") from exc
    if right <= left or bottom <= top:
        raise ValueError(f"{name} is invalid")
    return left, top, right, bottom


def _crop_to_selection(data: bytes, layer_value: object, selection_value: object) -> tuple[bytes, int, int]:
    layer = _image_bounds(layer_value, "layer_bounds")
    selection = _image_bounds(selection_value, "selection_bounds")
    width = selection[2] - selection[0]
    height = selection[3] - selection[1]
    if width > _MAX_IMAGE_EDGE or height > _MAX_IMAGE_EDGE or width * height > _MAX_IMAGE_PIXELS:
        raise ValueError("image dimensions are invalid")

    with Image.open(BytesIO(data)) as source_image:
        source = source_image.convert("RGBA")
        output = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        left = max(layer[0], selection[0])
        top = max(layer[1], selection[1])
        right = min(layer[2], selection[2])
        bottom = min(layer[3], selection[3])
        if right > left and bottom > top:
            source_box = (
                max(0, left - layer[0]),
                max(0, top - layer[1]),
                min(source.width, right - layer[0]),
                min(source.height, bottom - layer[1]),
            )
            if source_box[2] > source_box[0] and source_box[3] > source_box[1]:
                output.alpha_composite(
                    source.crop(source_box),
                    (left - selection[0], top - selection[1]),
                )
        encoded = BytesIO()
        output.save(encoded, format="PNG")
        result = encoded.getvalue()
    if len(result) > _MAX_IMAGE_BYTES:
        raise ValueError("image is too large")
    return result, width, height


def _response(payload: dict, status: int = 200) -> web.Response:
    return web.json_response(payload, status=status, headers=_CORS_HEADERS)


def _require_loopback(request: web.Request) -> web.Response | None:
    if _is_loopback(request.remote):
        return None
    return _response({"error": "Photoshop bridge is local-only"}, status=403)


@routes.options("/comfytv/photoshop/{tail:.*}")
async def photoshop_options(request: web.Request) -> web.Response:
    denied = _require_loopback(request)
    if denied is not None:
        return denied
    return web.Response(status=204, headers=_CORS_HEADERS)


@routes.get("/comfytv/photoshop/status")
async def photoshop_status(request: web.Request) -> web.Response:
    denied = _require_loopback(request)
    if denied is not None:
        return denied
    return _response({"ok": True})


@routes.post("/comfytv/photoshop/layer")
async def photoshop_layer(request: web.Request) -> web.Response:
    denied = _require_loopback(request)
    if denied is not None:
        return denied
    if request.content_length and request.content_length > _MAX_IMAGE_BYTES * 2:
        return _response({"error": "request is too large"}, status=413)
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("JSON body must be an object")
        data, width, height = _decode_png(body.get("image_base64"))
        if body.get("selection_bounds") is not None:
            data, width, height = _crop_to_selection(
                data,
                body.get("layer_bounds"),
                body.get("selection_bounds"),
            )
    except (ValueError, TypeError, web.HTTPException) as exc:
        return _response({"error": str(exc)}, status=400)

    input_dir = folder_paths.get_input_directory()
    output_dir = os.path.join(input_dir, *_SUBFOLDER.split("/"))
    os.makedirs(output_dir, exist_ok=True)
    filename = f"ps-layer-{time.time_ns()}-{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(output_dir, filename)
    with open(path, "xb") as image_file:
        image_file.write(data)

    payload = {
        "name": filename,
        "subfolder": _SUBFOLDER,
        "type": "input",
        "url": f"/view?filename={filename}&subfolder={_SUBFOLDER}&type=input",
        "document": _short_text(body.get("document")),
        "layer": _short_text(body.get("layer")),
        "width": width,
        "height": height,
        "bounds": body.get("bounds") if isinstance(body.get("bounds"), dict) else None,
        "create_new": body.get("create_new") is True,
    }
    try:
        PromptServer.instance.send_sync("comfytv-photoshop-layer", payload)
    except Exception:
        _log.exception("[ComfyTV/photoshop] layer event broadcast failed")
    return _response(payload)
