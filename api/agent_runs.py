"""Queue-less run API for callers that only speak prompts.

ComfyTV's Run button does not use ComfyUI's queue: the page posts the stage
graph to ``/comfytv/stage_runs`` and the plugin executes it in-process, so
stage runs stay independent of the queue (see ``api/stage_runs.py``). Tools
that can only POST a prompt -- the ``comfy`` CLI, a script, an agent -- had no
way in, because their result channel is ``/history`` / ``/api/jobs`` and those
never see an in-process run.

This module exposes the same executor under that contract::

    POST /comfytv/agent/prompt          -> {"prompt_id": "..."}   (like /prompt)
    GET  /comfytv/agent/history[/{id}]  -> history-shaped result
    GET  /comfytv/agent/queue           -> running/pending lists
    POST /comfytv/agent/runs/{id}/cancel

Finished runs are also mirrored into ComfyUI's prompt history, so a client that
already polls ``/history/{id}`` or ``/api/jobs/{id}`` sees them unchanged.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web

from ..runners._nested_exec import last_execution_error, use_execution_server
from ..runners.auth_extra import remember_credentials
from ..runners.progress_isolation import install_progress_isolation
from ._common import routes
from .stage_runs import StageRun, StageRunServer, _is_stage_class, _safe_extra_data

_log = logging.getLogger(__name__)

MAX_AGENT_RUNS = 200
AGENT_RUNS: dict[str, "AgentRun"] = {}
_RUNS_LOCK = threading.Lock()
# Prompt id of the agent run inside PromptExecutor right now. Cancel uses it
# so a global interrupt is only fired for that run, and only when the queue
# worker is idle (the interrupt flag is process-wide).
_EXECUTING_AGENT: str | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class AgentRun:
    """One in-process run submitted through the agent API."""

    id: str
    prompt: dict
    client_id: str | None = None
    extra_data: dict = field(default_factory=dict)
    output_node_ids: list[str] = field(default_factory=list)
    status: str = "running"          # running | success | error | cancelled
    outputs: dict = field(default_factory=dict)
    meta: dict = field(default_factory=dict)
    error: str = ""
    traceback: str = ""
    created_at_ms: int = field(default_factory=_now_ms)
    finished_at_ms: int | None = None
    cancelled: bool = False
    task: Any = None

    def history_item(self) -> dict:
        """ComfyUI's history entry shape, so /history and /api/jobs agree.

        The prompt tuple carries a copy of extra_data with credentials removed:
        ComfyUI never writes those into history, and neither should this.
        """
        ok = self.status == "success"
        done_event = "execution_success" if ok else (
            "execution_interrupted" if self.status == "cancelled" else "execution_error")
        end_payload: dict = {"prompt_id": self.id, "timestamp": _now_ms()}
        if not ok and self.status == "error":
            end_payload.update({
                "exception_message": self.error or "execution failed",
                "exception_type": "ExecutionError",
                "traceback": [self.traceback] if self.traceback else [],
                "node_id": None,
                "node_type": None,
            })
        extra = {
            key: value for key, value in self.extra_data.items()
            if key not in ("auth_token_comfy_org", "api_key_comfy_org")
        }
        item = {
            "prompt": (0, self.id, self.prompt, extra,
                       list(self.output_node_ids)),
            "outputs": self.outputs,
            "status": {
                "status_str": "success" if ok else "error",
                "completed": ok,
                "messages": [
                    ["execution_start", {"prompt_id": self.id,
                                         "timestamp": self.created_at_ms}],
                    [done_event, end_payload],
                ],
            },
        }
        if self.meta:
            item["meta"] = self.meta
        return item

    def job_summary(self) -> dict:
        return {
            "id": self.id,
            "status": "in_progress" if self.status == "running" else self.status,
            "create_time": self.created_at_ms,
            "source": "comfytv",
        }


def _prune_runs() -> None:
    with _RUNS_LOCK:
        if len(AGENT_RUNS) <= MAX_AGENT_RUNS:
            return
        finished = sorted(
            (r for r in AGENT_RUNS.values() if r.status != "running"),
            key=lambda r: r.created_at_ms,
        )
        for run in finished[: len(AGENT_RUNS) - MAX_AGENT_RUNS]:
            AGENT_RUNS.pop(run.id, None)


def _mirror_history(run: AgentRun) -> None:
    """Best-effort: let /history and /api/jobs see this run too.

    Credentials are stripped first. ComfyUI keeps them out of history on
    purpose (``SENSITIVE_EXTRA_DATA_KEYS``); copying the run's extra_data
    straight in would publish the Comfy.org token to anyone who can GET
    ``/history``.
    """
    try:
        from server import PromptServer
        queue = getattr(PromptServer.instance, "prompt_queue", None)
        if queue is None:
            return
        item = run.history_item()
        mutex = getattr(queue, "mutex", None)
        if mutex is not None:
            with mutex:
                queue.history[run.id] = item
        else:
            queue.history[run.id] = item
    except Exception:
        _log.debug("[ComfyTV/agent] history mirror skipped", exc_info=True)


def _stage_run_of(run: AgentRun) -> StageRun:
    """Progress plumbing shared with the page-driven runs."""
    return StageRun(
        id=run.id,
        node_id=run.output_node_ids[0] if run.output_node_ids else "",
        client_id=run.client_id,
    )


async def _execute_run(run: AgentRun) -> None:
    from execution import CacheType, PromptExecutor

    install_progress_isolation()
    server = StageRunServer(_stage_run_of(run))
    executor = PromptExecutor(
        server,
        cache_type=CacheType.CLASSIC,
        cache_args={"lru": 0, "ram": 0, "ram_inactive": 0},
    )

    def execute() -> None:
        global _EXECUTING_AGENT
        with _RUNS_LOCK:
            _EXECUTING_AGENT = run.id
        try:
            with use_execution_server(server):
                executor.execute(
                    run.prompt,
                    run.id,
                    extra_data={**run.extra_data, "client_id": run.client_id},
                    execute_outputs=run.output_node_ids,
                )
        finally:
            with _RUNS_LOCK:
                if _EXECUTING_AGENT == run.id:
                    _EXECUTING_AGENT = None

    try:
        await asyncio.to_thread(execute)
    except Exception as exc:  # noqa: BLE001 - reported through the run record
        run.status = "cancelled" if run.cancelled else "error"
        run.error = str(exc)
        run.finished_at_ms = _now_ms()
        _log.warning("[ComfyTV/agent] %s failed: %s", run.id, exc)
        _mirror_history(run)
        return

    # A cancel that lands after the graph already finished must not rewrite a
    # successful result. Only an interrupt that actually stopped the executor
    # counts as cancelled.
    if run.cancelled and not executor.success:
        run.status = "cancelled"
    elif executor.success:
        run.status = "success"
    else:
        detail = last_execution_error(executor) or {}
        run.status = "error"
        run.error = str(detail.get("exception_message") or "execution failed")
        trace = detail.get("traceback")
        run.traceback = "".join(trace) if isinstance(trace, list) else str(trace or "")
    result = executor.history_result or {}
    run.outputs = result.get("outputs", {}) or {}
    run.meta = result.get("meta", {}) or {}
    run.finished_at_ms = _now_ms()
    _mirror_history(run)


def _validate_prompt_shape(prompt: Any) -> str | None:
    if not isinstance(prompt, dict) or not prompt:
        return "prompt must be a non-empty object"
    for node_id, node in prompt.items():
        if not isinstance(node, dict) or not isinstance(node.get("class_type"), str):
            return f"node {node_id!r} must be an object with a class_type string"
    if not any(_is_stage_class(node.get("class_type")) for node in prompt.values()):
        return "prompt must contain at least one ComfyTV node"
    return None


@routes.post("/comfytv/agent/prompt")
async def start_agent_prompt(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "invalid JSON body"}, status=400)

    prompt = body.get("prompt")
    problem = _validate_prompt_shape(prompt)
    if problem is not None:
        return web.json_response({"error": problem}, status=400)

    targets = body.get("output_node_ids") or body.get("partial_execution_targets")
    if targets is not None:
        if not isinstance(targets, list) or not targets:
            return web.json_response(
                {"error": "output_node_ids must be a non-empty list"}, status=400)
        missing = [str(t) for t in targets if str(t) not in prompt]
        if missing:
            return web.json_response(
                {"error": f"output nodes not in prompt: {', '.join(missing)}"},
                status=400)

    from server import PromptServer
    from execution import validate_prompt

    PromptServer.instance.node_replace_manager.apply_replacements(prompt)
    supplied_id = body.get("prompt_id")
    if supplied_id not in (None, ""):
        run_id = str(supplied_id)
        if len(run_id) > 128:
            return web.json_response({"error": "prompt_id is too long"}, status=400)
        existing = AGENT_RUNS.get(run_id)
        if existing is not None and existing.status == "running":
            return web.json_response(
                {"error": f"prompt {run_id} is already running"}, status=409)
    else:
        run_id = f"comfytv-agent-{uuid.uuid4().hex}"
    valid = await validate_prompt(
        run_id, prompt, [str(t) for t in targets] if targets else None)
    if not valid[0]:
        return web.json_response(
            {"error": valid[1], "node_errors": valid[3]}, status=400)

    extra = _safe_extra_data(body)
    remember_credentials(extra)
    client_id = body.get("client_id")
    run = AgentRun(
        id=run_id,
        prompt=prompt,
        client_id=str(client_id) if client_id else None,
        extra_data=extra,
        output_node_ids=[str(n) for n in (valid[2] or [])],
    )
    with _RUNS_LOCK:
        AGENT_RUNS[run.id] = run
    _prune_runs()
    run.task = asyncio.create_task(_execute_run(run))
    return web.json_response(
        {"prompt_id": run.id, "number": 0, "node_errors": {}})


@routes.get("/comfytv/agent/history")
async def list_agent_history(request: web.Request) -> web.Response:
    try:
        limit = int(request.query.get("max_items", "50"))
    except ValueError:
        limit = 50
    rows = sorted(AGENT_RUNS.values(), key=lambda r: r.created_at_ms, reverse=True)
    return web.json_response({r.id: r.history_item() for r in rows[:max(1, limit)]})


@routes.get("/comfytv/agent/history/{prompt_id}")
async def get_agent_history(request: web.Request) -> web.Response:
    run = AGENT_RUNS.get(request.match_info["prompt_id"])
    if run is not None:
        return web.json_response({run.id: run.history_item()})
    try:
        from server import PromptServer
        queue = getattr(PromptServer.instance, "prompt_queue", None)
        if queue is not None:
            return web.json_response(
                queue.get_history(prompt_id=request.match_info["prompt_id"]))
    except Exception:
        _log.debug("[ComfyTV/agent] history fallback failed", exc_info=True)
    return web.json_response({})


@routes.get("/comfytv/agent/queue")
async def get_agent_queue(request: web.Request) -> web.Response:
    running = [r.job_summary() for r in AGENT_RUNS.values() if r.status == "running"]
    return web.json_response({"queue_running": running, "queue_pending": []})


@routes.post("/comfytv/agent/runs/{prompt_id}/cancel")
async def cancel_agent_run(request: web.Request) -> web.Response:
    run = AGENT_RUNS.get(request.match_info["prompt_id"])
    if run is None:
        return web.json_response({"error": "run not found"}, status=404)
    run.cancelled = True
    if run.status == "running":
        # ComfyUI's interrupt flag is process-global: it also stops whatever
        # the queue worker is doing. Only pull it when this run is the one
        # actually executing, so cancelling an agent job cannot kill an
        # unrelated prompt.
        try:
            from server import PromptServer
            queue = getattr(PromptServer.instance, "prompt_queue", None)
            queue_busy = False
            if queue is not None and getattr(queue, "mutex", None) is not None:
                with queue.mutex:
                    queue_busy = bool(getattr(queue, "currently_running", None))
            with _RUNS_LOCK:
                ours = _EXECUTING_AGENT == run.id
            if ours and not queue_busy:
                import comfy.model_management
                comfy.model_management.interrupt_current_processing()
        except Exception:
            _log.debug("[ComfyTV/agent] interrupt failed", exc_info=True)
    return web.json_response({"ok": True})
