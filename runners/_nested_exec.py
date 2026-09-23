import asyncio
import json
import urllib.parse


def _view_url(filename: str, subfolder: str, type_: str) -> str:
    qs = urllib.parse.urlencode({
        "filename": filename, "subfolder": subfolder, "type": type_,
    })
    return f"/view?{qs}"


_NESTED_EXECUTOR = None


_NESTED_LOCK: asyncio.Lock | None = None


def _get_nested_lock() -> asyncio.Lock:
    global _NESTED_LOCK
    if _NESTED_LOCK is None:
        _NESTED_LOCK = asyncio.Lock()
    return _NESTED_LOCK


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


def _get_nested_executor():
    global _NESTED_EXECUTOR
    if _NESTED_EXECUTOR is not None:
        return _NESTED_EXECUTOR
    from execution import CacheType, PromptExecutor
    from server import PromptServer
    _NESTED_EXECUTOR = PromptExecutor(
        PromptServer.instance,
        cache_type=CacheType.CLASSIC,
        cache_args={"lru": 0, "ram": 0, "ram_inactive": 0},
    )
    return _NESTED_EXECUTOR


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


async def _run_subprompt(sub_prompt: dict, sub_prompt_id: str,
                          execute_outputs: list[str]):

    from server import BinaryEventTypes, PromptServer

    server = PromptServer.instance
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

    loop = asyncio.get_running_loop()

    async with _get_nested_lock():
        executor = _get_nested_executor()

        outer_client_id = server.client_id
        outer_node_id = getattr(server, 'last_node_id', None)
        orig_send_sync = server.send_sync

        import comfy_execution.progress as _progress_mod
        outer_registry = getattr(_progress_mod, 'global_progress_registry', None)

        def wrapped_send_sync(event, data, sid=None):
            if preview_meta_event is not None:
                handled, payload = _filter_subprompt_preview(
                    event, data, sub_prompt_id, outer_node_id, preview_meta_event,
                )
                if handled:
                    if payload is not None:
                        orig_send_sync(payload[0], payload[1], sid)
                    return None
            is_sub = (
                isinstance(data, dict)
                and data.get('prompt_id') == sub_prompt_id
            )
            if is_sub and outer_node_id is not None:
                try:
                    for ev, payload in _translate_subprompt_event(
                        event, data, sub_prompt_id, outer_node_id, _aggregate,
                    ):
                        orig_send_sync(ev, payload, sid)
                except Exception:
                    pass
                return None
            return orig_send_sync(event, data, sid)

        server.send_sync = wrapped_send_sync
        try:
            from .auth_extra import nested_extra_data
            extra_data = nested_extra_data(outer_client_id)
            await loop.run_in_executor(
                None,
                lambda extra=extra_data: executor.execute(
                    sub_prompt, sub_prompt_id,
                    extra_data=extra,
                    execute_outputs=execute_outputs,
                ),
            )
        finally:
            server.send_sync = orig_send_sync
            server.client_id = outer_client_id
            if outer_registry is not None:
                _progress_mod.global_progress_registry = outer_registry

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


def _remember_compositor_ui(outputs: dict, payload: str) -> str:
    try:
        cui = _compositor_ui()
    except Exception:
        return payload
    ui = cui.harvest_compositor_ui(outputs)
    if not ui:
        return payload
    try:
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
