import asyncio
import types

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


async def _make_client(monkeypatch, *, executor_factory=None):
    import execution
    import server
    from ComfyTV import api  # noqa: F401
    from ComfyTV.api import agent_runs

    async def validate_prompt(prompt_id, prompt, targets):
        return True, None, targets or list(prompt.keys()), {}

    monkeypatch.setattr(execution, "validate_prompt", validate_prompt, raising=False)
    monkeypatch.setattr(
        server.PromptServer.instance,
        "node_replace_manager",
        types.SimpleNamespace(apply_replacements=lambda prompt: None),
        raising=False,
    )
    if executor_factory is not None:
        monkeypatch.setattr(execution, "PromptExecutor", executor_factory, raising=False)
    monkeypatch.setattr(agent_runs, "install_progress_isolation", lambda: None)

    agent_runs.AGENT_RUNS.clear()
    app = web.Application()
    app.router.add_routes(server.PromptServer.instance.routes)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client, agent_runs


async def _close(client, agent_runs, timeout=2.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while any(r.status == "running" for r in agent_runs.AGENT_RUNS.values()):
        if asyncio.get_event_loop().time() > deadline:
            break
        await asyncio.sleep(0.01)
    agent_runs.AGENT_RUNS.clear()
    await client.close()


class _FakeExecutor:
    """Stands in for ComfyUI's PromptExecutor: records args, reports one output."""

    instances: list = []

    def __init__(self, server, **kwargs):
        self.server = server
        self.success = True
        self.history_result = {}
        self.calls = []
        _FakeExecutor.instances.append(self)

    def execute(self, prompt, prompt_id, extra_data, execute_outputs):
        self.calls.append((prompt, prompt_id, extra_data, execute_outputs))
        self.history_result = {
            "outputs": {"7": {"output": ["/view?filename=a.png&type=output"]}},
            "meta": {"7": {"node_id": "7"}},
        }


def test_agent_prompt_runs_a_stage_and_reports_history(monkeypatch):
    async def run():
        _FakeExecutor.instances.clear()
        client, agent_runs = await _make_client(monkeypatch, executor_factory=_FakeExecutor)
        try:
            response = await client.post("/comfytv/agent/prompt", json={
                "prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
                "output_node_ids": ["7"],
                "client_id": "agent-1",
                "extra_data": {"auth_token_comfy_org": "tok", "junk": "x"},
            })
            assert response.status == 200
            prompt_id = (await response.json())["prompt_id"]
            assert prompt_id.startswith("comfytv-agent-")

            for _ in range(200):
                run = agent_runs.AGENT_RUNS[prompt_id]
                if run.status != "running":
                    break
                await asyncio.sleep(0.01)
            assert run.status == "success"
            assert run.outputs == {"7": {"output": ["/view?filename=a.png&type=output"]}}

            prompt, run_id, extra, outputs = _FakeExecutor.instances[-1].calls[0]
            assert run_id == prompt_id
            assert outputs == ["7"]
            assert extra["client_id"] == "agent-1"
            # The whitelist keeps credentials, drops everything else.
            assert extra["auth_token_comfy_org"] == "tok"
            assert "junk" not in extra

            history = await (await client.get(
                f"/comfytv/agent/history/{prompt_id}")).json()
            entry = history[prompt_id]
            assert entry["status"]["status_str"] == "success"
            # Credentials must not leak into the history-shaped response.
            assert "auth_token_comfy_org" not in entry["prompt"][3]
            assert "junk" not in entry["prompt"][3]
            assert entry["prompt"][1] == prompt_id
            assert entry["outputs"]["7"]["output"]

            listing = await (await client.get("/comfytv/agent/history")).json()
            assert prompt_id in listing

            queue = await (await client.get("/comfytv/agent/queue")).json()
            assert queue == {"queue_running": [], "queue_pending": []}
        finally:
            await _close(client, agent_runs)

    asyncio.run(run())


def test_agent_prompt_requires_a_comfytv_node(monkeypatch):
    async def run():
        client, agent_runs = await _make_client(monkeypatch)
        try:
            response = await client.post("/comfytv/agent/prompt", json={
                "prompt": {"1": {"class_type": "SaveImage", "inputs": {}}},
            })
            assert response.status == 400
            assert "ComfyTV" in (await response.json())["error"]
        finally:
            await _close(client, agent_runs)

    asyncio.run(run())


def test_agent_prompt_rejects_unknown_output_nodes(monkeypatch):
    async def run():
        client, agent_runs = await _make_client(monkeypatch)
        try:
            response = await client.post("/comfytv/agent/prompt", json={
                "prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
                "output_node_ids": ["9"],
            })
            assert response.status == 400
            assert "not in prompt" in (await response.json())["error"]
        finally:
            await _close(client, agent_runs)

    asyncio.run(run())


def test_agent_history_unknown_id_is_empty(monkeypatch):
    async def run():
        client, agent_runs = await _make_client(monkeypatch)
        try:
            response = await client.get("/comfytv/agent/history/nope")
            assert response.status == 200
            assert await response.json() == {}
        finally:
            await _close(client, agent_runs)

    asyncio.run(run())


def test_agent_run_records_a_failure(monkeypatch):
    class FailingExecutor(_FakeExecutor):
        def execute(self, prompt, prompt_id, extra_data, execute_outputs):
            self.success = False
            self.status_messages = [("execution_error", {
                "exception_message": "Unauthorized: Please login first",
                "exception_type": "ApiError",
                "traceback": ["tb\n"],
            })]

    async def run():
        _FakeExecutor.instances.clear()
        client, agent_runs = await _make_client(monkeypatch, executor_factory=FailingExecutor)
        try:
            response = await client.post("/comfytv/agent/prompt", json={
                "prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
            })
            prompt_id = (await response.json())["prompt_id"]
            for _ in range(200):
                run = agent_runs.AGENT_RUNS[prompt_id]
                if run.status != "running":
                    break
                await asyncio.sleep(0.01)
            assert run.status == "error"
            assert "Unauthorized" in run.error
            history = await (await client.get(
                f"/comfytv/agent/history/{prompt_id}")).json()
            assert history[prompt_id]["status"]["status_str"] == "error"
        finally:
            await _close(client, agent_runs)

    asyncio.run(run())


def test_agent_prompt_rejects_a_second_run_with_the_same_id(monkeypatch):
    async def run():
        client, agent_runs = await _make_client(monkeypatch)

        async def hang(_run):
            await asyncio.Event().wait()

        monkeypatch.setattr(agent_runs, "_execute_run", hang)
        try:
            first = await client.post("/comfytv/agent/prompt", json={
                "prompt_id": "same-id",
                "prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
            })
            assert first.status == 200
            second = await client.post("/comfytv/agent/prompt", json={
                "prompt_id": "same-id",
                "prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
            })
            assert second.status == 409
        finally:
            for pending in agent_runs.AGENT_RUNS.values():
                pending.status = "cancelled"
                if pending.task is not None:
                    pending.task.cancel()
            await _close(client, agent_runs)

    asyncio.run(run())


def test_agent_cancel_is_idempotent(monkeypatch):
    async def run():
        client, agent_runs = await _make_client(monkeypatch)
        try:
            missing = await client.post("/comfytv/agent/runs/nope/cancel")
            assert missing.status == 404
        finally:
            await _close(client, agent_runs)

    asyncio.run(run())
