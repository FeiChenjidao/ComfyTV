import asyncio
import struct
import uuid
from dataclasses import dataclass

from aiohttp import web

from server import PromptServer

from ..nodes.stages.common.meta import STAGE_META
from ..runners._nested_exec import (
    last_execution_error,
    send_prompt_server_sync,
    use_execution_server,
)
from ..runners.progress_isolation import install_progress_isolation
from ._common import routes


@dataclass
class StageRun:
    id: str
    node_id: str
    client_id: str | None
    stage_uid: str | None = None
    cancelled: bool = False
    task: asyncio.Task | None = None


ACTIVE_STAGE_RUNS: dict[str, StageRun] = {}


def _is_stage_class(class_type) -> bool:
    if not isinstance(class_type, str) or not class_type.startswith("ComfyTV."):
        return False
    return class_type.split(".", 1)[1] in STAGE_META


class StageRunServer:
    def __init__(self, run: StageRun):
        self.run = run
        self.client_id = run.client_id
        self.last_node_id = None

    def send_sync(self, event, data, sid=None):
        if self.run.cancelled:
            return
        if event in ("progress", "progress_text"):
            payload = dict(data) if isinstance(data, dict) else data
            if isinstance(payload, dict):
                source_node = payload.get("nodeId", payload.get("node_id", payload.get("node")))
                outer_node = str(self.run.node_id)
                if source_node is not None:
                    payload["source_node"] = str(source_node)
                payload["node"] = outer_node
                payload["node_id"] = outer_node
                payload["nodeId"] = outer_node
                payload["job_id"] = self.run.id
                if self.run.stage_uid:
                    payload["stage_uid"] = self.run.stage_uid
            send_prompt_server_sync(event, payload, self.client_id)
            return
        try:
            from server import BinaryEventTypes
            preview_event = getattr(BinaryEventTypes, "PREVIEW_IMAGE_WITH_METADATA", None)
            text_event = getattr(BinaryEventTypes, "TEXT", None)
        except Exception:
            preview_event = None
            text_event = None
        if text_event is not None and event == text_event and isinstance(data, (bytes, bytearray)):
            raw = bytes(data)
            if len(raw) >= 4:
                source_len = struct.unpack(">I", raw[:4])[0]
                if len(raw) >= 4 + source_len:
                    text = raw[4 + source_len:].decode("utf-8", errors="replace")
                    send_prompt_server_sync(
                        "progress_text",
                        {
                            "node": str(self.run.node_id),
                            "node_id": str(self.run.node_id),
                            "nodeId": str(self.run.node_id),
                            "text": text,
                            "job_id": self.run.id,
                            **({"stage_uid": self.run.stage_uid} if self.run.stage_uid else {}),
                        },
                        self.client_id,
                    )
                    return
        if preview_event is not None and event == preview_event:
            send_prompt_server_sync(event, data, self.client_id)


def _send_run_event(run: StageRun, status: str, **payload) -> None:
    send_prompt_server_sync(
        "comfytv-stage-run",
        {
            "job_id": run.id,
            "node_id": run.node_id,
            **({"stage_uid": run.stage_uid} if run.stage_uid else {}),
            "status": status,
            **payload,
        },
        run.client_id,
    )


def _safe_extra_data(body: dict) -> dict:
    supplied = body.get("extra_data")
    extra = {}
    if isinstance(supplied, dict):
        for key in (
            "auth_token_comfy_org",
            "api_key_comfy_org",
            "comfy_usage_source",
        ):
            value = supplied.get(key)
            if isinstance(value, str) and value.strip():
                extra[key] = value.strip()
    workflow = body.get("workflow")
    if isinstance(workflow, dict):
        extra["extra_pnginfo"] = {"workflow": workflow}
    return extra


async def _execute_stage_run(
    run: StageRun,
    prompt: dict,
    outputs_to_execute: list[str],
    extra_data: dict,
) -> None:
    from execution import CacheType, PromptExecutor

    install_progress_isolation()
    server = StageRunServer(run)
    executor = PromptExecutor(
        server,
        cache_type=CacheType.CLASSIC,
        cache_args={"lru": 0, "ram": 0, "ram_inactive": 0},
    )

    def execute() -> None:
        with use_execution_server(server):
            executor.execute(
                prompt,
                run.id,
                extra_data={**extra_data, "client_id": run.client_id},
                execute_outputs=outputs_to_execute,
            )

    try:
        _send_run_event(run, "running")
        await asyncio.to_thread(execute)
        if run.cancelled:
            return
        if not executor.success:
            detail = last_execution_error(executor) or {}
            _send_run_event(
                run,
                "error",
                error=str(detail.get("exception_message") or "execution failed"),
                error_type=str(detail.get("exception_type") or "ExecutionError"),
                traceback=detail.get("traceback"),
            )
            return
        outputs = (executor.history_result or {}).get("outputs", {})
        _send_run_event(run, "done", ui=outputs.get(run.node_id) or {})
    except Exception as exc:
        if not run.cancelled:
            _send_run_event(
                run,
                "error",
                error=str(exc),
                error_type=type(exc).__name__,
            )
    finally:
        ACTIVE_STAGE_RUNS.pop(run.id, None)


@routes.post("/comfytv/stage_runs")
async def start_stage_run(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)

    prompt = body.get("prompt")
    target_node_id = str(body.get("target_node_id") or "")
    if not isinstance(prompt, dict) or not target_node_id:
        return web.json_response(
            {"error": "prompt and target_node_id are required"}, status=400,
        )
    if target_node_id not in prompt:
        return web.json_response({"error": "target node is not in prompt"}, status=400)
    target = prompt[target_node_id]
    target_class = target.get("class_type") if isinstance(target, dict) else None
    if not _is_stage_class(target_class):
        return web.json_response({"error": "target must be a ComfyTV stage"}, status=400)
    if any(
        not isinstance(node, dict)
        or not _is_stage_class(node.get("class_type"))
        for node in prompt.values()
    ):
        return web.json_response(
            {"error": "stage run prompt contains a non-ComfyTV node"}, status=400,
        )

    from execution import validate_prompt

    PromptServer.instance.node_replace_manager.apply_replacements(prompt)
    run_id = f"comfytv-stage-{uuid.uuid4().hex}"
    valid = await validate_prompt(run_id, prompt, [target_node_id])
    if not valid[0]:
        return web.json_response(
            {"error": valid[1], "node_errors": valid[3]}, status=400,
        )

    client_id = body.get("client_id")
    stage_uid = body.get("stage_uid")
    run = StageRun(
        id=run_id,
        node_id=target_node_id,
        client_id=str(client_id) if client_id else None,
        stage_uid=str(stage_uid) if stage_uid else None,
    )
    ACTIVE_STAGE_RUNS[run.id] = run
    extra_data = _safe_extra_data(body)
    # The page always sends the user's Comfy.org credentials; keep the newest
    # pair so queue/agent runs that cannot carry them still reach API nodes.
    from ..runners.auth_extra import remember_credentials
    remember_credentials(extra_data)
    run.task = asyncio.create_task(_execute_stage_run(
        run,
        prompt,
        [str(node_id) for node_id in valid[2]],
        extra_data,
    ))
    return web.json_response({"job_id": run.id})


@routes.post("/comfytv/stage_runs/{job_id}/cancel")
async def cancel_stage_run(request: web.Request) -> web.Response:
    run = ACTIVE_STAGE_RUNS.get(request.match_info["job_id"])
    if run is None:
        return web.json_response({"error": "stage run not found"}, status=404)
    run.cancelled = True
    _send_run_event(run, "cancelled")
    ACTIVE_STAGE_RUNS.pop(run.id, None)
    return web.json_response({"ok": True})
