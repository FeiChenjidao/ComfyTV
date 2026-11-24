import json
import logging
import urllib.parse
from typing import Any

from comfy_api.latest import io

from .... import storage as _storage_module
from .meta import STAGE_META, _KIND_TO_OUTPUT_TYPE
from .progress import _emit_progress
from .timing import consume_invoke_duration


_JSON_PAYLOAD_TYPES = {'storyboard', 'images', 'timeline', 'material'}

# Output type -> the standard ComfyUI output key a consumer (the /api/jobs
# preview, an agent reading history) already knows how to render.
_STANDARD_OUTPUT_KEYS = {
    'image':  'images',
    'images': 'images',
    'video':  'videos',
    'audio':  'audio',
}


def _view_ref(url) -> dict | None:
    """Turn a ``/view?...`` URL into the ``{filename, subfolder, type}`` ref."""
    if not isinstance(url, str) or not url.startswith('/view?'):
        return None
    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    filename = (query.get('filename') or [''])[0]
    if not filename:
        return None
    return {
        'filename': filename,
        'subfolder': (query.get('subfolder') or [''])[0],
        'type': (query.get('type') or ['output'])[0],
        'url': url,
    }


def _standard_output_refs(output_type: str, payload_str, picked=None) -> dict:
    """Standard file refs for the output, so non-ComfyTV clients can find files.

    The stage's own payload stays in ``output`` (JSON or a URL); these keys are
    additive and mirror what a SaveImage/SaveVideo node would report, which is
    what ComfyUI's job preview and external agents read.
    """
    key = _STANDARD_OUTPUT_KEYS.get(output_type)
    if key is None or not isinstance(payload_str, str):
        return {}
    candidates: list[str] = [payload_str]
    try:
        data = json.loads(payload_str)
    except (ValueError, TypeError):
        data = None
    if isinstance(data, dict):
        candidates = [
            str(item.get('image_url') or item.get('url') or '')
            for item in data.get('images') or []
            if isinstance(item, dict)
        ]
        multi = data.get('multi')
        if isinstance(multi, dict):
            candidates.extend(str(value or '') for value in multi.values())
    if picked:
        candidates.insert(0, str(picked))
    refs: list[dict] = []
    seen: set[str] = set()
    for url in candidates:
        ref = _view_ref(url)
        if ref is None or ref['url'] in seen:
            continue
        seen.add(ref['url'])
        refs.append(ref)
    return {key: refs} if refs else {}


def _publish_external_run(cls, *, ui_data: dict, project_id: str,
                          duration_ms=None) -> None:
    """Broadcast a queue-triggered stage result to every open page."""
    try:
        from ....runners._nested_exec import in_plugin_stage_run
        if in_plugin_stage_run():
            return
        from ....runners import stage_events
        from ....runners._nested_exec import executing_prompt_id
        node_id = getattr(getattr(cls, "hidden", None), "unique_id", None)
        stage_events.broadcast_stage_run(
            node_id=node_id,
            status='done',
            ui=ui_data,
            project_id=project_id or '',
            stage_uid=stage_events.stage_uid_from_hidden(cls, node_id)
                      or _mirror_uid(project_id or '', node_id, _stage_name(cls)),
            prompt_id=executing_prompt_id(),
            duration_ms=duration_ms,
        )
    except Exception:
        logging.debug("[ComfyTV/stage] external run publish skipped", exc_info=True)


def _stage_name(cls) -> str:
    name = getattr(cls, '__name__', '') or ''
    return name[:-5] if name.endswith('Clone') else name


def _pnginfo_uid(cls, node_id):
    """The stage's uid straight from the queued prompt's workflow (node.properties)."""
    if node_id is None:
        return None
    info = getattr(getattr(cls, "hidden", None), "extra_pnginfo", None)
    workflow = info.get("workflow") if isinstance(info, dict) else None
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    for n in nodes or []:
        if str(n.get("id")) == str(node_id):
            uid = (n.get("properties") or {}).get("comfytv_stage_uid")
            return str(uid) if uid else None
    return None


def _mirror_uid(project_id: str, node_id, stage_class: str):
    if node_id is None:
        return None
    try:
        from ....api.canvas_state import get_canvas_state
        snap = get_canvas_state(project_id or None)
    except Exception:
        return None
    if not snap.get("available"):
        return None
    for st in snap.get("stages") or []:
        if str(st.get("graph_node_id")) == str(node_id) \
                and str(st.get("stage_class") or "") == stage_class:
            return str(st.get("uid") or "") or None
    return None


def _persist(
    *,
    cls,
    project_id: str,
    output_type: str,
    payload_url: str,
    payload_json=None,
    params=None,
    parent_output_id=None,
    picked_index=None,
    duration_ms=None,
):
    from .provenance import consume_last_provenance
    provenance = consume_last_provenance()
    if params is None:
        params = provenance
    try:
        node_id = getattr(cls.hidden, "unique_id", None) if hasattr(cls, "hidden") else None
        row = _storage_module.persist_output(
            project_id=project_id or "",
            stage_class=_stage_name(cls),
            stage_node_id=str(node_id) if node_id is not None else None,
            stage_uid=(_pnginfo_uid(cls, node_id)
                       or _mirror_uid(project_id or "", node_id, _stage_name(cls))),
            output_type=output_type,
            payload_url=payload_url,
            payload_json=payload_json,
            params=params,
            parent_output_id=int(parent_output_id) if parent_output_id else None,
            picked_index=int(picked_index) if picked_index is not None else None,
            duration_ms=int(duration_ms) if duration_ms is not None else None,
        )
        try:
            from ....runners import eagle as _eagle
            _eagle.auto_send_output(
                payload_url=payload_url,
                output_type=output_type,
                project_id=project_id or "",
                stage_class=_stage_name(cls),
                params=params,
                payload_json=payload_json,
            )
        except Exception:
            logging.debug("[ComfyTV] eagle auto-send skipped", exc_info=True)
        return row.get('id') if row else None
    except Exception as e:
        logging.warning("[ComfyTV] persist_output failed for %s: %s", cls.__name__, e)
        return None


def _stage_emit_auto(cls, *, project_id, payload_str, params=None, emit_ui: bool = True,
                     parent_output_id=None, picked_payload=None, picked_index=None,
                     extra_outputs=None, duration_ms=None, extra_ui=None):
    meta = STAGE_META.get(_stage_name(cls))
    if meta is None:
        logging.warning(
            "[ComfyTV] STAGE_META miss for %s; defaulting output_type to 'image'",
            _stage_name(cls),
        )
        meta = {}
    kind = meta.get('kind', 'image')
    output_type = _KIND_TO_OUTPUT_TYPE.get(kind, kind)
    _emit_progress(cls, 1, 1, text="done")
    return _stage_emit(cls, project_id=project_id, output_type=output_type,
                       payload_str=payload_str, params=params, emit_ui=emit_ui,
                       parent_output_id=parent_output_id,
                       picked_payload=picked_payload, picked_index=picked_index,
                       extra_outputs=extra_outputs, duration_ms=duration_ms,
                       extra_ui=extra_ui)


def _stage_emit(
    cls,
    *,
    project_id: str,
    output_type: str,
    payload_str: str,
    params=None,
    emit_ui: bool = True,
    parent_output_id=None,
    picked_payload=None,
    picked_index=None,
    extra_outputs=None,
    duration_ms=None,
    extra_ui=None,
):
    if duration_ms is None:
        duration_ms = consume_invoke_duration()
    is_json = output_type in _JSON_PAYLOAD_TYPES

    payload_json = None
    if is_json:
        try:
            payload_json = json.loads(payload_str)
        except (ValueError, TypeError):
            payload_json = payload_str
    row_id = _persist(
        cls=cls,
        project_id=project_id,
        output_type=output_type,
        payload_url=payload_str if not is_json else "",
        payload_json=payload_json,
        params=params,
        parent_output_id=parent_output_id,
        picked_index=picked_index,
        duration_ms=duration_ms,
    )
    has_pick = picked_payload is not None
    extras = tuple(extra_outputs or ())
    if emit_ui:
        ui_data: dict = {"output": [payload_str]}
        if has_pick:
            ui_data["picked"] = [picked_payload]
            if picked_index is not None:
                ui_data["picked_index"] = [int(picked_index)]
        if row_id is not None:
            ui_data["output_id"] = [row_id]
        if duration_ms is not None:
            ui_data["duration_ms"] = [int(duration_ms)]
        ui_data.update(_standard_output_refs(
            output_type, payload_str, picked_payload if has_pick else None))
        if extra_ui:
            ui_data.update(extra_ui)
        _publish_external_run(cls, ui_data=ui_data, project_id=project_id,
                              duration_ms=duration_ms)
        if has_pick:
            return io.NodeOutput(payload_str, picked_payload, *extras, ui=ui_data)
        return io.NodeOutput(payload_str, *extras, ui=ui_data)
    if has_pick:
        return io.NodeOutput(payload_str, picked_payload, *extras)
    return io.NodeOutput(payload_str, *extras)


def _input_file_url(filename: str) -> str:
    if not filename:
        return ''
    slash = filename.rfind('/')
    subfolder = filename[:slash] if slash >= 0 else ''
    name = filename[slash + 1:] if slash >= 0 else filename
    params = {'filename': name, 'type': 'input'}
    if subfolder:
        params['subfolder'] = subfolder
    return f"/view?{urllib.parse.urlencode(params)}"


def _pick_image_from_batch(batch: Any, selected_index: int) -> str:
    if isinstance(batch, str):
        try:
            data = json.loads(batch)
        except (ValueError, TypeError):
            return batch.strip()
    else:
        data = batch
    images = data.get("images", []) if isinstance(data, dict) else []
    if not isinstance(images, list):
        return ""
    match = next(
        (img for img in images if str(img.get("index")) == str(selected_index)),
        None,
    )
    if match is None and 1 <= selected_index <= len(images):
        match = images[selected_index - 1]
    return str(match.get("image_url", "")) if isinstance(match, dict) else ""
