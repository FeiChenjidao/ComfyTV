import asyncio
import contextlib
import contextvars
import json
import shutil
import threading
import urllib.parse
import uuid
from _thread import LockType
from pathlib import Path

import folder_paths


def _view_url(filename: str, subfolder: str, type_: str) -> str:
    qs = urllib.parse.urlencode({
        "filename": filename, "subfolder": subfolder, "type": type_,
    })
    return f"/view?{qs}"


_NESTED_LOCK: LockType | None = None
_EXECUTION_SERVER = contextvars.ContextVar("comfytv_execution_server", default=None)
_ROUTING_PROMPT_EVENT = contextvars.ContextVar("comfytv_routing_prompt_event", default=False)
_PROMPT_SERVER_SEND_SYNC = None


def _get_nested_lock() -> LockType:
    global _NESTED_LOCK
    if _NESTED_LOCK is None:
        _NESTED_LOCK = threading.Lock()
    return _NESTED_LOCK


@contextlib.asynccontextmanager
async def _nested_resource_lock():
    lock = _get_nested_lock()
    await asyncio.to_thread(lock.acquire)
    try:
        yield
    finally:
        lock.release()


class NestedWorkflowError(RuntimeError):
    def __init__(self, sub_prompt_id: str, detail: dict | None = None):
        self.sub_prompt_id = sub_prompt_id
        self.detail = dict(detail or {})
        d = self.detail
        if d:
            head = (
                f"Local workflow failed — {d.get('node_type') or 'node'} "
                f"#{d.get('node_id')} raised {d.get('exception_type') or 'Exception'}"
            )
            msg = str(d.get('exception_message') or '').strip()
            if msg:
                head += f": {msg}"
        else:
            head = "Local workflow failed"
        super().__init__(f"{head} (sub_prompt_id={sub_prompt_id})")
        tb = d.get('traceback')
        self.inner_traceback = ''.join(tb) if isinstance(tb, list) else (tb or None)


def last_execution_error(executor) -> dict | None:
    for event, data in reversed(list(getattr(executor, 'status_messages', None) or [])):
        if event == 'execution_error' and isinstance(data, dict):
            return data
    return None


def _new_nested_executor(server):
    from execution import CacheType, PromptExecutor
    return PromptExecutor(
        server,
        cache_type=CacheType.CLASSIC,
        cache_args={"lru": 0, "ram": 0, "ram_inactive": 0},
    )


def _route_contextual_prompt_event(instance, original, event, data, sid=None):
    target = _EXECUTION_SERVER.get()
    if target is not None and target is not instance and not _ROUTING_PROMPT_EVENT.get():
        token = _ROUTING_PROMPT_EVENT.set(True)
        try:
            return target.send_sync(event, data, sid)
        finally:
            _ROUTING_PROMPT_EVENT.reset(token)
    return original(event, data, sid)


def install_contextual_prompt_routing() -> None:
    global _PROMPT_SERVER_SEND_SYNC
    if _PROMPT_SERVER_SEND_SYNC is not None:
        return
    from server import PromptServer

    instance = PromptServer.instance
    original = instance.send_sync

    def wrapped(event, data, sid=None):
        return _route_contextual_prompt_event(instance, original, event, data, sid)

    wrapped._comfytv_contextual_route = True
    _PROMPT_SERVER_SEND_SYNC = original
    instance.send_sync = wrapped


def send_prompt_server_sync(event, data, sid=None):
    from server import PromptServer

    if _PROMPT_SERVER_SEND_SYNC is not None:
        return _PROMPT_SERVER_SEND_SYNC(event, data, sid)
    return PromptServer.instance.send_sync(event, data, sid)


@contextlib.contextmanager
def use_execution_server(server):
    install_contextual_prompt_routing()
    token = _EXECUTION_SERVER.set(server)
    try:
        yield
    finally:
        _EXECUTION_SERVER.reset(token)


def in_plugin_stage_run() -> bool:
    """True when the running node belongs to a ComfyTV-initiated run.

    ``api/stage_runs.py`` (the Run button) and ``api/agent_runs.py`` bind an
    execution server for the whole prompt; ComfyUI's own queue does not. The
    distinction matters because queue runs have no page waiting for the
    result, so their outcome has to be broadcast instead of replied to.
    """
    return _EXECUTION_SERVER.get() is not None


def executing_prompt_id() -> str | None:
    """Prompt id of the execution currently running this node, if known."""
    try:
        from comfy_execution.utils import get_executing_context
        context = get_executing_context()
    except Exception:
        return None
    prompt_id = getattr(context, "prompt_id", None) if context is not None else None
    return str(prompt_id) if prompt_id else None


def _translate_subprompt_event(event, data, sub_prompt_id, outer_node_id, aggregate):
    if event == 'progress_state':
        nodes_dict = data.get('nodes') or {}
        if not nodes_dict:
            return []
        v, m = aggregate(nodes_dict)
        return [('progress', {
            'value':     v,
            'max':       m,
            'prompt_id': sub_prompt_id,
            'node':      str(outer_node_id),
        })]
    if event == 'progress':
        return []
    if event == 'progress_text':
        return [('progress_text', {
            **data,
            'node_id': str(outer_node_id),
            'nodeId':  str(outer_node_id),
        })]
    return []


def _filter_subprompt_preview(event, data, sub_prompt_id, outer_node_id, preview_event_type):
    if event != preview_event_type:
        return (False, None)
    if not (isinstance(data, tuple) and len(data) == 2 and isinstance(data[1], dict)):
        return (False, None)
    image, meta = data
    if meta.get('prompt_id') != sub_prompt_id:
        return (False, None)
    if outer_node_id is None:
        return (True, None)
    oid = str(outer_node_id)
    rewritten = {**meta, 'node_id': oid, 'display_node_id': oid}
    return (True, (event, (image, rewritten)))


class _NestedServer:
    def __init__(self, server, client_id, outer_node_id, sub_prompt_id,
                 preview_event_type, aggregate):
        self._server = server
        self.client_id = client_id
        self.last_node_id = None
        self._outer_node_id = outer_node_id
        self._sub_prompt_id = sub_prompt_id
        self._preview_event_type = preview_event_type
        self._aggregate = aggregate

    def send_sync(self, event, data, sid=None):
        handled, payload = _filter_subprompt_preview(
            event,
            data,
            self._sub_prompt_id,
            self._outer_node_id,
            self._preview_event_type,
        )
        if handled:
            if payload is not None:
                self._server.send_sync(payload[0], payload[1], self.client_id)
            return
        is_sub = isinstance(data, dict) and data.get("prompt_id") == self._sub_prompt_id
        if is_sub and self._outer_node_id is not None:
            try:
                translated = _translate_subprompt_event(
                    event,
                    data,
                    self._sub_prompt_id,
                    self._outer_node_id,
                    self._aggregate,
                )
            except Exception:
                translated = []
            for translated_event, translated_payload in translated:
                self._server.send_sync(
                    translated_event, translated_payload, self.client_id,
                )
            return
        if not is_sub:
            self._server.send_sync(event, data, self.client_id)


async def _run_subprompt(sub_prompt: dict, sub_prompt_id: str,
                          execute_outputs: list[str], *, allow_parallel: bool = False):

    from server import BinaryEventTypes, PromptServer

    server = _EXECUTION_SERVER.get() or PromptServer.instance
    preview_meta_event = getattr(BinaryEventTypes, 'PREVIEW_IMAGE_WITH_METADATA', None)

    total_nodes = float(len(sub_prompt) or 1)

    def _aggregate(nodes_dict: dict) -> tuple[float, float]:
        finished = 0.0
        running_frac = 0.0
        for st in nodes_dict.values():
            if not isinstance(st, dict):
                continue
            stt = st.get('state')
            if stt in ('finished', 'cached'):
                finished += 1.0
            elif stt == 'running':
                try:
                    v = float(st.get('value') or 0)
                    m = float(st.get('max') or 1)
                    if m > 0:
                        running_frac += min(1.0, v / m)
                except (TypeError, ValueError):
                    pass
        return finished + running_frac, total_nodes

    try:
        from comfy_execution.utils import get_executing_context
        context = get_executing_context()
    except ImportError:
        context = None
    outer_node_id = context.node_id if context is not None else getattr(server, 'last_node_id', None)
    outer_client_id = getattr(server, 'client_id', None)
    nested_server = _NestedServer(
        server,
        outer_client_id,
        outer_node_id,
        sub_prompt_id,
        preview_meta_event,
        _aggregate,
    )
    executor = _new_nested_executor(nested_server)

    async def execute():
        from .auth_extra import nested_extra_data
        extra_data = nested_extra_data(outer_client_id)
        await asyncio.to_thread(
            executor.execute,
            sub_prompt,
            sub_prompt_id,
            extra_data,
            execute_outputs,
        )

    if allow_parallel:
        await execute()
    else:
        async with _nested_resource_lock():
            await execute()

    if not executor.success:
        raise NestedWorkflowError(sub_prompt_id, last_execution_error(executor))
    return executor


_SAVE_UI_KEYS = ("images", "audio", "videos", "gifs", "video", "3d")


def _compositor_ui():
    import importlib.util
    import sys
    from pathlib import Path

    name = f"{__name__.split('.', 1)[0]}.nodes.stages.common.compositor_ui"
    cached = sys.modules.get(name)
    if cached is not None:
        return cached
    path = Path(__file__).resolve().parent.parent / "nodes" / "stages" / "common" / "compositor_ui.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _persist_compositor_ui(ui: dict) -> dict:
    """Copy local compositor temp files to stable output storage."""
    temp_root = Path(folder_paths.get_temp_directory()).resolve()
    output_root = Path(folder_paths.get_output_directory()).resolve()
    dest_dir = output_root / "comfytv" / "layer-separation" / uuid.uuid4().hex[:12]
    copied: dict[tuple[str, str, str], dict] = {}

    def persist(ref):
        if not isinstance(ref, dict) or not ref.get("filename"):
            return ref
        if str(ref.get("type") or "temp") != "temp":
            return dict(ref)
        key = (
            str(ref.get("type") or "temp"),
            str(ref.get("subfolder") or ""),
            str(ref["filename"]),
        )
        if key in copied:
            return dict(copied[key])
        source = (temp_root / key[1] / key[2]).resolve()
        source.relative_to(temp_root)
        if not source.is_file():
            return dict(ref)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / source.name
        shutil.copy2(source, dest)
        saved = {
            "filename": dest.name,
            "subfolder": dest.parent.relative_to(output_root).as_posix(),
            "type": "output",
        }
        copied[key] = saved
        return dict(saved)

    localized = dict(ui)
    for key in ("compositor_layers", "images"):
        refs = ui.get(key)
        if isinstance(refs, list):
            localized[key] = [persist(ref) for ref in refs]
    return localized


def _remember_compositor_ui(outputs: dict, payload: str) -> str:
    try:
        cui = _compositor_ui()
    except Exception:
        return payload
    ui = cui.harvest_compositor_ui(outputs)
    if not ui:
        return payload
    try:
        ui = _persist_compositor_ui(ui)
        return cui.pack_payload_with_compositor_ui(payload, ui)
    except Exception:
        return payload


def _save_files_from(save_out: dict) -> list[dict]:
    if not isinstance(save_out, dict):
        return []
    for key in _SAVE_UI_KEYS:
        items = save_out.get(key)
        if items:
            return list(items)
    return []


async def _extract_result(executor, result_meta: dict) -> str:
    rtype = result_meta.get("type")
    node_id = result_meta.get("node")
    if not node_id:
        raise RuntimeError(
            "result.node is required (id of the save / output node to read)"
        )

    outputs = (executor.history_result or {}).get("outputs", {})
    payload = await _extract_result_raw(executor, result_meta, outputs)
    return _remember_compositor_ui(outputs, payload)


async def _extract_result_raw(executor, result_meta: dict, outputs: dict) -> str:
    rtype = result_meta.get("type")
    node_id = result_meta.get("node")

    if rtype in ("ui_save_url", "ui_save_layered"):
        items = _save_files_from(outputs.get(node_id) or {})
        if not items:
            raise RuntimeError(f"save node {node_id!r} produced no files")
        if rtype == "ui_save_layered":
            layered = [
                it for it in items
                if str(it.get("filename", "")).lower().endswith((".psd", ".psb"))
            ]
            items = layered or items
        first = items[0]
        return _view_url(
            filename=first.get("filename", ""),
            subfolder=first.get("subfolder", ""),
            type_=first.get("type", "output"),
        )

    if rtype == "ui_save_batch":
        files: list[dict] = []
        ordered_ids = [node_id] if result_meta.get("only_node") else             [node_id] + [k for k in outputs.keys() if k != node_id]
        for nid in ordered_ids:
            files.extend(_save_files_from(outputs.get(nid) or {}))
        if not files:
            raise RuntimeError("workflow produced no image files")
        images = [
            {
                "index": str(i + 1),
                "label": f"#{i + 1}",
                "image_url": _view_url(
                    filename=it.get("filename", ""),
                    subfolder=it.get("subfolder", ""),
                    type_=it.get("type", "output"),
                ),
            }
            for i, it in enumerate(files)
        ]
        return json.dumps({"images": images})

    if rtype == "multi":
        multi: dict[str, str] = {}
        for sub in result_meta.get("outputs") or []:
            key = str(sub.get("id") or sub.get("kind") or sub.get("node"))
            multi[key] = await _extract_result_raw(executor, sub, outputs)
        return json.dumps({"multi": multi})

    if rtype == "graph_output_first":
        entry = await executor.caches.outputs.get(node_id)
        if entry is None or not getattr(entry, "outputs", None):
            raise RuntimeError(f"node {node_id!r} produced no graph output")
        slot = entry.outputs[0]
        if not slot:
            raise RuntimeError(f"node {node_id!r} output slot 0 was empty")
        return str(slot[0]) if slot[0] is not None else ""

    raise RuntimeError(f"unsupported result.type: {rtype!r}")
