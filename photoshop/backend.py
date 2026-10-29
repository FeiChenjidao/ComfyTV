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
        if "canvasBase64" in msg:
            await save_file(msg["canvasBase64"], "PS_canvas.png")
        if "maskBase64" in msg:
            await save_file(msg["maskBase64"], "PS_mask.png")
        if "configdata" in msg:
            await save_config(msg["configdata"])
        if "workspace" in msg:
            await send_message(comfyui_users, "workspace", msg["workspace"])
        if msg.get("queue"):
            await send_message(comfyui_users, "queue", msg["queue"])
        if not any(key in msg for key in ("configdata", "maskBase64", "canvasBase64", "workspace", "queue")):
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
        await send_message(photoshop_users, "render", encoded)
    except Exception as error:
        print(f"# PS: Error reading or sending render: {error}")
    return web.Response(text="Render sent to ps")


def register_routes():
    routes = PromptServer.instance.routes
    try:
        routes.get("/ps/ws")(websocket_handler)
        routes.get("/ps/inputs/{filename}")(inputs_file)
        routes.get("/ps/renderdone")(render_done)
        print("# PS: ComfyTV Photoshop bridge ready")
    except Exception as error:
        print("# PS: Photoshop routes are already registered. Remove the comfyui-photoshop custom node so ComfyTV can own them.")
        print(f"# PS: {error}")


register_routes()
