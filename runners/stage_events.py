"""Publish stage results to every open ComfyTV page.

The plugin's own runs answer on the websocket channel of the page that started
them (``api/stage_runs.py`` posts ``comfytv-stage-run`` to one ``client_id``).
A run that reaches us through ComfyUI's queue instead -- the ``comfy`` CLI, a
script, an agent posting ``/prompt`` -- has no such page: its ``ui`` payload is
addressed to the *submitting* client id, so open canvases keep showing a stale
card (or nothing at all) even though the run succeeded. Republishing the result
to every client keeps them in sync; a page ignores events for runs it is
driving itself.
"""
from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)

STAGE_RUN_EVENT = "comfytv-stage-run"


def broadcast_stage_run(
    *,
    node_id: Any,
    status: str = "done",
    ui: dict | None = None,
    project_id: str = "",
    stage_uid: str | None = None,
    prompt_id: str | None = None,
    error: str | None = None,
    error_type: str | None = None,
    traceback: str | None = None,
    duration_ms: int | None = None,
) -> None:
    """Send a stage outcome to every connected client (``external`` marks it)."""
    if node_id is None or node_id == "":
        return
    payload: dict[str, Any] = {
        "node_id": str(node_id),
        "status": status,
        "external": True,
    }
    if ui:
        payload["ui"] = ui
    if project_id:
        payload["project_id"] = str(project_id)
    if stage_uid:
        payload["stage_uid"] = str(stage_uid)
    if prompt_id:
        payload["prompt_id"] = str(prompt_id)
    if duration_ms is not None:
        payload["duration_ms"] = int(duration_ms)
    if error:
        payload["error"] = str(error)
    if error_type:
        payload["error_type"] = str(error_type)
    if traceback:
        payload["traceback"] = str(traceback)
    try:
        from server import PromptServer
        PromptServer.instance.send_sync(STAGE_RUN_EVENT, payload)
    except Exception:
        _log.debug("[ComfyTV/stage] external result broadcast failed", exc_info=True)


def stage_uid_from_hidden(cls, node_id) -> str | None:
    """The stage's uid from the queued prompt's workflow (node.properties)."""
    if node_id is None:
        return None
    try:
        info = getattr(getattr(cls, "hidden", None), "extra_pnginfo", None)
        workflow = info.get("workflow") if isinstance(info, dict) else None
        nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
        for node in nodes or []:
            if not isinstance(node, dict) or str(node.get("id")) != str(node_id):
                continue
            uid = (node.get("properties") or {}).get("comfytv_stage_uid")
            return str(uid) if uid else None
    except Exception:
        return None
    return None
