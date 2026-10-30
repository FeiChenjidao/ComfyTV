import base64
import json
import os
import uuid

import folder_paths
from aiohttp import WSMsgType, web
from server import PromptServer

ROOT = os.path.dirname(os.path.realpath(__file__))
PS_INPUTS = os.path.join(ROOT, "data", "ps_inputs")
os.makedirs(PS_INPUTS, exist_ok=True)

clients = {}
photoshop_users = []
comfyui_users = []


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


async def websocket_handler(request):
    ws = web.WebSocketResponse(max_msg_size=128 * 1024 * 1024)
    await ws.prepare(request)
    client_id = request.query.get("clientId", str(uuid.uuid4()))
    platform = request.query.get("platform", "unknown")
    clients[client_id] = {"ws": ws, "platform": platform}

    if platform == "ps":
        photoshop_users.append(client_id)
        print(f"# PS: {client_id} Photoshop Connected")
        await send_message(comfyui_users, "photoshopConnected")
    elif platform == "cm":
        comfyui_users.append(client_id)
        if photoshop_users:
            await send_message(comfyui_users, "photoshopConnected")

    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            await handle_message(platform, msg.data)
        elif msg.type == WSMsgType.ERROR:
            print(f"# PS: Connection error from client {client_id}: {ws.exception()}")

    clients.pop(client_id, None)
    if platform == "ps" and client_id in photoshop_users:
        photoshop_users.remove(client_id)
        print(f"# PS: User {client_id} disconnected from Photoshop (ps)")
    elif platform == "cm" and client_id in comfyui_users:
        comfyui_users.remove(client_id)
        print(f"# PS: User {client_id} disconnected from ComfyUI (cm)")
    return ws


async def handle_message(platform, data):
    msg = json.loads(data)
    if platform == "cm":
        try:
            if "pullupdate" in msg or "install_plugin" in msg:
                await send_message(comfyui_users, "alert", "Photoshop bridge is part of ComfyTV. Update ComfyTV, not comfyui-photoshop.")
            else:
                await send_message(photoshop_users, "", json.dumps(msg))
        except Exception as error:
            print(f"# PS: error from ComfyUI: {error}")
        return

    if platform != "ps":
        return
    try:
        if msg.get("referenceClear"):
            clear_reference_files()
        if "referenceBase64" in msg:
            await save_file(msg["referenceBase64"], reference_filename(msg.get("referenceIndex")))
        if "canvasBase64" in msg:
            await save_file(msg["canvasBase64"], "PS_canvas.png")
        if "maskBase64" in msg:
            await save_file(msg["maskBase64"], "PS_mask.png")
        if "configdata" in msg:
            await save_config(msg["configdata"])
        if "workspace" in msg:
            await send_message(comfyui_users, "workspace", msg["workspace"])
        if msg.get("queue"):
            forward = {
                "queue": True,
                "renderProfile": msg.get("renderProfile") or {},
                "referenceCount": int(msg.get("referenceCount") or 0),
            }
            if "workflow" in msg:
                forward["workflow"] = msg["workflow"]
            await send_message(comfyui_users, "", json.dumps(forward))
        if not any(key in msg for key in ("configdata", "maskBase64", "canvasBase64", "workspace", "queue", "referenceClear", "referenceBase64")):
            await send_message(comfyui_users, "", json.dumps(msg))
    except Exception as error:
        print(f"# PS: error from Photoshop: {error}")


async def inputs_file(request):
    filename = os.path.basename(request.match_info["filename"])
    file = os.path.join(PS_INPUTS, filename)
    if not os.path.isfile(file):
        return web.Response(status=404)
    return web.FileResponse(file)


async def render_done(request):
    print("# PS: render done")
    try:
        filename = os.path.basename(request.rel_url.query.get("filename") or "")
        path = os.path.join(folder_paths.get_temp_directory(), filename)
        with open(path, "rb") as image_file:
            encoded = base64.b64encode(image_file.read()).decode("utf-8")
        payload = {"render": encoded}
        try:
            payload["thumb"] = thumb_png_base64(path)
        except Exception as error:
            print(f"# PS: thumb skipped: {error}")
        await send_message(photoshop_users, "", json.dumps(payload))
    except Exception as error:
        print(f"# PS: Error reading or sending render: {error}")
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
    try:
        raw = await request.read()
        if not raw or len(raw) > 80 * 1024 * 1024:
            return web.Response(status=413)
        return web.Response(body=thumb_png_bytes(raw), content_type="image/png")
    except Exception as error:
        print(f"# PS: thumb failed: {error}")
        return web.Response(status=400)


def register_routes():
    routes = PromptServer.instance.routes
    try:
        routes.get("/ps/ws")(websocket_handler)
        routes.get("/ps/inputs/{filename}")(inputs_file)
        routes.get("/ps/renderdone")(render_done)
        routes.post("/ps/thumb")(make_thumb)
        print("# PS: ComfyTV Photoshop bridge ready")
    except Exception as error:
        print("# PS: Photoshop routes are already registered. Remove the comfyui-photoshop custom node so ComfyTV can own them.")
        print(f"# PS: {error}")


register_routes()
