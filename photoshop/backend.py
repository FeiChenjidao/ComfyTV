import asyncio
import base64
import ipaddress
import json
import os
import re
import shutil
import time
import uuid

import folder_paths
from aiohttp import WSMsgType, web
from server import PromptServer

ROOT = os.path.dirname(os.path.realpath(__file__))
PHOTOSHOP_WORKFLOW = os.path.join(os.path.dirname(ROOT), "workflows", "image", "PS_NanoBanana_GPTImage.json")
LEGACY_PS_INPUTS = os.path.join(ROOT, "data", "ps_inputs")
USER_DIRECTORY = folder_paths.get_user_directory()
PS_INPUTS = os.path.join(USER_DIRECTORY, "comfytv", "photoshop", "ps_inputs")
os.makedirs(PS_INPUTS, exist_ok=True)


def migrate_legacy_inputs():
    if not os.path.isdir(LEGACY_PS_INPUTS):
        return
    has_mask = False
    try:
        with open(os.path.join(LEGACY_PS_INPUTS, "config.json"), "r", encoding="utf-8") as file:
            has_mask = bool(json.load(file).get("hasMask"))
    except (OSError, ValueError):
        pass
    names = ["config.json", "PS_canvas.png"]
    if has_mask:
        names.append("PS_mask.png")
    names.extend(f"PS_ref_{index}.png" for index in range(1, 7))
    for name in names:
        source = os.path.join(LEGACY_PS_INPUTS, name)
        target = os.path.join(PS_INPUTS, name)
        if not os.path.isfile(source) or os.path.exists(target):
            continue
        try:
            shutil.copy2(source, target)
        except OSError as error:
            print(f"# PS: failed to migrate {name}: {error}")


migrate_legacy_inputs()

clients = {}
photoshop_users = []
comfyui_users = []
photoshop_bindings = {}
active_jobs = {}
auth_transfers = {}

PROTOCOL_VERSION = 3
AUTH_TRANSFER_TTL_SECONDS = 5 * 60
AUTH_TRANSFER_MAX_BYTES = 1024 * 1024
AUTH_TRANSFER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
FIREBASE_AUTH_PREFIX = "firebase:authUser:"
REFERENCE_MAX_EDGE = 2048
REFERENCE_MAX_FILE_BYTES = 1024 * 1024 * 1024
REFERENCE_MAX_PIXELS = 400_000_000
REFERENCE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


async def save_file(data, filename):
    raw = base64.b64decode(data)
    with open(os.path.join(PS_INPUTS, filename), "wb") as file:
        file.write(raw)


async def save_config(data):
    with open(os.path.join(PS_INPUTS, "config.json"), "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False)


def clear_reference_files():
    if not os.path.isdir(PS_INPUTS):
        return
    for name in os.listdir(PS_INPUTS):
        if name.startswith("PS_ref_") and name.endswith(".png"):
            try:
                os.remove(os.path.join(PS_INPUTS, name))
            except OSError:
                pass


def clear_mask_file():
    path = os.path.join(PS_INPUTS, "PS_mask.png")
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        pass


def reference_filename(index):
    try:
        number = int(index)
    except (TypeError, ValueError):
        number = 1
    number = max(1, min(6, number))
    return f"PS_ref_{number}.png"


async def send_message(users, kind, message=True):
    try:
        if not users:
            print("# PS: PS not connected")
            return "PS not connected"
        latest_user = users[-1]
        if latest_user not in clients:
            print(f"# PS: User {latest_user} not connected")
            return
        data = json.dumps({kind: message}) if kind else message
        await clients[latest_user]["ws"].send_str(data)
    except Exception as error:
        print(f"# PS: error send_message: {error}")


async def send_to_client(client_id, payload):
    client = clients.get(client_id)
    if not client:
        return False
    try:
        data = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        await client["ws"].send_str(data)
        return True
    except Exception as error:
        print(f"# PS: error sending to {client_id}: {error}")
        return False


def ready_comfy_clients():
    return [
        client_id for client_id in comfyui_users
        if client_id in clients and clients[client_id].get("ready")
    ]


def bound_comfy_client(ps_client_id):
    current = photoshop_bindings.get(ps_client_id)
    if current in clients and clients[current].get("ready"):
        return current
    ready = ready_comfy_clients()
    preferred = [
        client_id for client_id in ready
        if clients[client_id].get("ps_client_id") == ps_client_id
    ]
    unclaimed = [
        client_id for client_id in ready
        if not clients[client_id].get("ps_client_id")
    ]
    selected = (preferred or unclaimed or ready)[-1] if ready else None
    if selected:
        photoshop_bindings[ps_client_id] = selected
    else:
        photoshop_bindings.pop(ps_client_id, None)
    return selected


async def fail_jobs_for_client(client_id, message):
    affected = [
        (job_id, job) for job_id, job in active_jobs.items()
        if job.get("cm_client_id") == client_id or job.get("ps_client_id") == client_id
    ]
    for job_id, job in affected:
        ps_client_id = job.get("ps_client_id")
        if ps_client_id in clients:
            await send_to_client(ps_client_id, {
                "protocolVersion": PROTOCOL_VERSION,
                "jobId": job_id,
                "jobStatus": {"phase": "error", "message": message},
            })
        active_jobs.pop(job_id, None)


async def websocket_handler(request):
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Photoshop bridge is only available locally")
    ws = web.WebSocketResponse(max_msg_size=128 * 1024 * 1024)
    await ws.prepare(request)
    client_id = request.query.get("clientId", str(uuid.uuid4()))
    platform = request.query.get("platform", "unknown")
    clients[client_id] = {
        "ws": ws,
        "platform": platform,
        "ready": False,
        "workflow_fingerprint": "",
        "protocol_version": 1,
        "ps_client_id": "",
    }

    if platform == "ps":
        if client_id not in photoshop_users:
            photoshop_users.append(client_id)
        print(f"# PS: {client_id} Photoshop Connected")
        await send_message(comfyui_users, "photoshopConnected")
    elif platform == "cm":
        if client_id not in comfyui_users:
            comfyui_users.append(client_id)
        if photoshop_users:
            await send_message(comfyui_users, "photoshopConnected")

    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            await handle_message(client_id, platform, msg.data)
        elif msg.type == WSMsgType.ERROR:
            print(f"# PS: Connection error from client {client_id}: {ws.exception()}")

    await fail_jobs_for_client(client_id, "Photoshop 与 ComfyUI 的任务连接已断开")
    clients.pop(client_id, None)
    if platform == "ps" and client_id in photoshop_users:
        photoshop_users.remove(client_id)
        photoshop_bindings.pop(client_id, None)
        print(f"# PS: User {client_id} disconnected from Photoshop (ps)")
    elif platform == "cm" and client_id in comfyui_users:
        comfyui_users.remove(client_id)
        for ps_client_id, cm_client_id in list(photoshop_bindings.items()):
            if cm_client_id == client_id:
                photoshop_bindings.pop(ps_client_id, None)
        print(f"# PS: User {client_id} disconnected from ComfyUI (cm)")
    return ws


async def handle_message(client_id, platform, data):
    msg = json.loads(data)
    if platform == "cm":
        try:
            hello = msg.get("bridgeHello")
            if isinstance(hello, dict):
                clients[client_id]["ready"] = bool(hello.get("ready"))
                clients[client_id]["workflow_fingerprint"] = str(hello.get("workflowFingerprint") or "")
                clients[client_id]["protocol_version"] = int(hello.get("protocolVersion") or 1)
                ps_client_id = str(hello.get("psClientId") or "")
                if ps_client_id in clients and clients[ps_client_id].get("platform") == "ps":
                    clients[client_id]["ps_client_id"] = ps_client_id
                    photoshop_bindings[ps_client_id] = client_id
                return
            if "bridgeReady" in msg:
                clients[client_id]["ready"] = bool(msg.get("bridgeReady"))
                clients[client_id]["workflow_fingerprint"] = str(msg.get("workflowFingerprint") or "")
                clients[client_id]["protocol_version"] = int(msg.get("protocolVersion") or 1)
            if "pullupdate" in msg or "install_plugin" in msg:
                await send_to_client(client_id, {
                    "alert": "Photoshop bridge is part of ComfyTV. Update the source checkout, not comfyui-photoshop."
                })
                return
            job_id = str(msg.get("jobId") or "")
            job = active_jobs.get(job_id)
            if job and job.get("cm_client_id") == client_id:
                await send_to_client(job["ps_client_id"], msg)
                phase = str((msg.get("jobStatus") or {}).get("phase") or "")
                if phase in ("completed", "error", "interrupted"):
                    active_jobs.pop(job_id, None)
                return
            if job_id:
                return
            await send_message(photoshop_users, "", json.dumps(msg))
        except Exception as error:
            print(f"# PS: error from ComfyUI: {error}")
        return

    if platform != "ps":
        return
    try:
        if msg.get("referenceClear"):
            clear_reference_files()
        if msg.get("maskClear"):
            clear_mask_file()
        if "referenceBase64" in msg:
            await save_file(msg["referenceBase64"], reference_filename(msg.get("referenceIndex")))
        if "canvasBase64" in msg:
            await save_file(msg["canvasBase64"], "PS_canvas.png")
        if "maskBase64" in msg:
            await save_file(msg["maskBase64"], "PS_mask.png")
        if "configdata" in msg:
            await save_config(msg["configdata"])
        if "workspace" in msg:
            cm_client_id = bound_comfy_client(client_id)
            if cm_client_id:
                await send_to_client(cm_client_id, {"workspace": msg["workspace"]})
        if msg.get("queue"):
            job_id = str(msg.get("jobId") or uuid.uuid4())
            cm_client_id = bound_comfy_client(client_id)
            if not cm_client_id:
                await send_to_client(client_id, {
                    "protocolVersion": PROTOCOL_VERSION,
                    "jobId": job_id,
                    "jobStatus": {
                        "phase": "error",
                        "message": "没有打开包含 Photoshop 输入与送回节点的 ComfyUI 工作流",
                    },
                })
                return
            active_jobs[job_id] = {
                "ps_client_id": client_id,
                "cm_client_id": cm_client_id,
                "created_at": time.monotonic(),
            }
            forward = {
                "protocolVersion": PROTOCOL_VERSION,
                "queue": True,
                "jobId": job_id,
                "psClientId": client_id,
                "batchIndex": int(msg.get("batchIndex") or 0),
                "renderProfile": msg.get("renderProfile") or {},
                "referenceCount": int(msg.get("referenceCount") or 0),
            }
            if "workflow" in msg:
                forward["workflow"] = msg["workflow"]
            await send_to_client(cm_client_id, forward)
        if msg.get("interrupt"):
            job_id = str(msg.get("jobId") or "")
            job = active_jobs.get(job_id)
            if job and job.get("ps_client_id") == client_id:
                await send_to_client(job["cm_client_id"], {
                    "protocolVersion": PROTOCOL_VERSION,
                    "interrupt": True,
                    "jobId": job_id,
                })
        if isinstance(msg.get("jobAck"), dict):
            job_id = str(msg.get("jobId") or "")
            job = active_jobs.get(job_id)
            if job and job.get("ps_client_id") == client_id:
                await send_to_client(job["cm_client_id"], msg)
                if str(msg["jobAck"].get("phase") or "") == "completed":
                    await send_to_client(client_id, {
                        "protocolVersion": PROTOCOL_VERSION,
                        "jobId": job_id,
                        "jobStatus": {"phase": "completed", "progress": 100},
                    })
                    active_jobs.pop(job_id, None)
        handled = (
            "configdata", "maskBase64", "maskClear", "canvasBase64", "workspace", "queue",
            "referenceClear", "referenceBase64", "interrupt", "jobAck",
        )
        if not any(key in msg for key in handled):
            cm_client_id = bound_comfy_client(client_id)
            if cm_client_id:
                await send_to_client(cm_client_id, msg)
    except Exception as error:
        print(f"# PS: error from Photoshop: {error}")


async def inputs_file(request):
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Photoshop inputs are only available locally")
    filename = os.path.basename(request.match_info["filename"])
    file = os.path.join(PS_INPUTS, filename)
    if not os.path.isfile(file):
        return web.Response(status=404)
    return web.FileResponse(file)


async def send_render_payload(encoded, job_id="", thumb="", layered=None):
    job_id = str(job_id or "")
    if not encoded:
        raise ValueError("Missing render payload")
    payload = {
        "protocolVersion": PROTOCOL_VERSION,
        "jobId": job_id,
        "render": encoded,
        "jobStatus": {"phase": "result_received", "progress": 100},
    }
    if thumb:
        payload["thumb"] = thumb
    if layered:
        payload["layered"] = layered
    job = active_jobs.get(job_id)
    if job:
        await send_to_client(job["ps_client_id"], payload)
    elif active_jobs:
        print(f"# PS: dropped render for inactive job {job_id or '<missing>'}")
    else:
        payload["jobId"] = ""
        payload["manualRender"] = True
        await send_message(photoshop_users, "", json.dumps(payload))
    return payload


async def send_render_file(filename, job_id=""):
    filename = os.path.basename(filename or "")
    if not filename:
        raise ValueError("Missing render filename")
    path = os.path.join(folder_paths.get_temp_directory(), filename)
    with open(path, "rb") as image_file:
        raw = image_file.read()
    encoded = base64.b64encode(raw).decode("utf-8")
    thumb = ""
    try:
        thumb = base64.b64encode(thumb_png_bytes(raw)).decode("ascii")
    except Exception as error:
        print(f"# PS: thumb skipped: {error}")
    return await send_render_payload(encoded, job_id, thumb)


async def photoshop_workflow(request):
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Photoshop workflow is only available locally")
    if not os.path.isfile(PHOTOSHOP_WORKFLOW):
        raise web.HTTPNotFound(text="Photoshop workflow is missing")
    response = web.FileResponse(PHOTOSHOP_WORKFLOW)
    response.headers["Cache-Control"] = "no-store"
    return response


async def render_done(request):
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Photoshop render callback is only available locally")
    print("# PS: render done")
    try:
        await send_render_file(
            request.rel_url.query.get("filename") or "",
            request.rel_url.query.get("jobId") or "",
        )
    except Exception as error:
        print(f"# PS: Error reading or sending render: {error}")
        return web.Response(status=500, text=str(error))
    return web.Response(text="Render sent to ps")


def thumb_png_bytes(raw, edge=160):
    import io
    from PIL import Image

    resample = Image.Resampling.BILINEAR if hasattr(Image, "Resampling") else Image.BILINEAR
    with Image.open(io.BytesIO(raw)) as image:
        image.thumbnail((edge, edge), resample)
        if image.mode == "RGB":
            output = image
        else:
            rgba = image.convert("RGBA")
            output = Image.new("RGB", rgba.size, (0, 0, 0))
            output.paste(rgba, mask=rgba.getchannel("A"))
        buffer = io.BytesIO()
        output.save(buffer, format="PNG")
        return buffer.getvalue()


def thumb_png_base64(path, edge=160):
    with open(path, "rb") as image_file:
        return base64.b64encode(thumb_png_bytes(image_file.read(), edge)).decode("ascii")


async def make_thumb(request):
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Photoshop thumbnail service is only available locally")
    try:
        raw = await request.read()
        if not raw or len(raw) > 80 * 1024 * 1024:
            return web.Response(status=413)
        return web.Response(body=thumb_png_bytes(raw), content_type="image/png")
    except Exception as error:
        print(f"# PS: thumb failed: {error}")
        return web.Response(status=400)


def prepare_reference_png(path, edge=REFERENCE_MAX_EDGE):
    import io
    from PIL import Image

    previous_pixel_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = REFERENCE_MAX_PIXELS
    try:
        with Image.open(path) as image:
            source_width, source_height = image.size
            if source_width <= 0 or source_height <= 0:
                raise ValueError("图片尺寸无效")
            if source_width * source_height > REFERENCE_MAX_PIXELS:
                raise ValueError("图片像素数量过大")

            resample = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
            image.thumbnail((edge, edge), resample, reducing_gap=3.0)
            output_width, output_height = image.size
            has_alpha = "A" in image.getbands() or (image.mode == "P" and "transparency" in image.info)
            if has_alpha:
                output = image.convert("RGBA")
            elif image.mode == "L":
                output = image.copy()
            else:
                output = image.convert("RGB")

            buffer = io.BytesIO()
            output.save(buffer, format="PNG", optimize=False, compress_level=6)
            return buffer.getvalue(), {
                "source_width": source_width,
                "source_height": source_height,
                "output_width": output_width,
                "output_height": output_height,
            }
    finally:
        Image.MAX_IMAGE_PIXELS = previous_pixel_limit


async def prepare_reference(request):
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Reference preparation is only available locally")
    try:
        payload = await request.json()
    except (json.JSONDecodeError, ValueError):
        raise web.HTTPBadRequest(text="Invalid JSON")

    path = os.path.realpath(str(payload.get("path") or "")) if isinstance(payload, dict) else ""
    if not path or not os.path.isfile(path):
        raise web.HTTPNotFound(text="Image file not found")
    if os.path.splitext(path)[1].lower() not in REFERENCE_EXTENSIONS:
        raise web.HTTPBadRequest(text="Unsupported image format")
    source_bytes = os.path.getsize(path)
    if source_bytes <= 0:
        raise web.HTTPBadRequest(text="Image file is empty")
    if source_bytes > REFERENCE_MAX_FILE_BYTES:
        raise web.HTTPRequestEntityTooLarge(max_size=REFERENCE_MAX_FILE_BYTES, actual_size=source_bytes)

    try:
        raw, info = await asyncio.to_thread(prepare_reference_png, path, REFERENCE_MAX_EDGE)
    except (OSError, ValueError) as error:
        raise web.HTTPBadRequest(text=str(error))
    headers = {
        "X-Source-Width": str(info["source_width"]),
        "X-Source-Height": str(info["source_height"]),
        "X-Output-Width": str(info["output_width"]),
        "X-Output-Height": str(info["output_height"]),
        "X-Source-Bytes": str(source_bytes),
    }
    return web.Response(body=raw, content_type="image/png", headers=headers)


def _is_loopback_request(request):
    try:
        return ipaddress.ip_address(request.remote or "").is_loopback
    except ValueError:
        return False


def _prune_auth_transfers(now=None):
    now = time.monotonic() if now is None else now
    expired = [key for key, item in auth_transfers.items() if item["expires"] <= now]
    for key in expired:
        auth_transfers.pop(key, None)


def _auth_transfer_id(request):
    transfer_id = request.match_info.get("transfer_id", "")
    if not AUTH_TRANSFER_ID_PATTERN.fullmatch(transfer_id):
        raise web.HTTPBadRequest(text="Invalid auth transfer id")
    if not _is_loopback_request(request):
        raise web.HTTPForbidden(text="Auth transfer is only available locally")
    _prune_auth_transfers()
    return transfer_id


def _valid_auth_envelope(value, legacy_entries=None):
    source = value if isinstance(value, dict) else {}
    local_source = source.get("localStorage")
    if not isinstance(local_source, dict):
        local_source = legacy_entries if isinstance(legacy_entries, dict) else {}
    local_entries = {
        key: item for key, item in local_source.items()
        if isinstance(key, str) and key.startswith(FIREBASE_AUTH_PREFIX) and isinstance(item, str)
    }
    indexed_entries = []
    for item in source.get("indexedDb") if isinstance(source.get("indexedDb"), list) else []:
        if not isinstance(item, dict) or "key" not in item or "value" not in item:
            continue
        indexed_entries.append({"key": item["key"], "value": item["value"]})
        if len(indexed_entries) >= 128:
            break
    envelope = {
        "version": 2,
        "localStorage": local_entries,
        "indexedDb": indexed_entries,
    }
    for key in ("token", "apiKey"):
        item = source.get(key)
        if isinstance(item, str) and item:
            envelope[key] = item
    encoded = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
    if len(encoded) > AUTH_TRANSFER_MAX_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=AUTH_TRANSFER_MAX_BYTES,
            actual_size=len(encoded),
        )
    return envelope


async def auth_transfer_write(request):
    transfer_id = _auth_transfer_id(request)
    if request.content_length and request.content_length > AUTH_TRANSFER_MAX_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=AUTH_TRANSFER_MAX_BYTES,
            actual_size=request.content_length,
        )
    try:
        payload = await request.json()
    except (json.JSONDecodeError, ValueError):
        raise web.HTTPBadRequest(text="Invalid JSON")
    envelope = _valid_auth_envelope(
        payload.get("envelope") if isinstance(payload, dict) else None,
        payload.get("entries") if isinstance(payload, dict) else None,
    )
    if not envelope["localStorage"] and not envelope["indexedDb"] and not envelope.get("token") and not envelope.get("apiKey"):
        raise web.HTTPBadRequest(text="No authentication state")
    auth_transfers[transfer_id] = {
        "envelope": envelope,
        "expires": time.monotonic() + AUTH_TRANSFER_TTL_SECONDS,
    }
    return web.json_response({"ok": True})


async def auth_transfer_read(request):
    transfer_id = _auth_transfer_id(request)
    item = auth_transfers.get(transfer_id)
    if not item:
        return web.json_response({"ready": False})
    envelope = item["envelope"]
    return web.json_response({
        "ready": True,
        "envelope": envelope,
        "entries": envelope.get("localStorage", {}),
    })


async def auth_transfer_delete(request):
    transfer_id = _auth_transfer_id(request)
    auth_transfers.pop(transfer_id, None)
    return web.json_response({"ok": True})


def register_routes():
    routes = PromptServer.instance.routes
    try:
        routes.get("/ps/ws")(websocket_handler)
        routes.get("/ps/inputs/{filename}")(inputs_file)
        routes.get("/ps/renderdone")(render_done)
        routes.get("/comfytv/photoshop/workflow")(photoshop_workflow)
        routes.post("/ps/thumb")(make_thumb)
        routes.post("/ps/reference/prepare")(prepare_reference)
        routes.get("/comfytv/photoshop/auth-transfer/{transfer_id}")(auth_transfer_read)
        routes.post("/comfytv/photoshop/auth-transfer/{transfer_id}")(auth_transfer_write)
        routes.delete("/comfytv/photoshop/auth-transfer/{transfer_id}")(auth_transfer_delete)
        print("# PS: ComfyTV Photoshop bridge ready")
    except Exception as error:
        print("# PS: Photoshop routes are already registered. Remove the comfyui-photoshop custom node so ComfyTV can own them.")
        print(f"# PS: {error}")


register_routes()
