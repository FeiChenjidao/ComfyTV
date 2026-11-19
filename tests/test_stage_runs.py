import asyncio
import struct
import types

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


async def _make_client(monkeypatch):
    from ComfyTV import api  # noqa: F401
    from ComfyTV.api import stage_runs
    import execution
    import server

    async def validate_prompt(prompt_id, prompt, targets):
        return True, None, targets, {}

    gate = asyncio.Event()

    async def execute_stage_run(run, prompt, outputs_to_execute, extra_data):
        await gate.wait()

    monkeypatch.setattr(execution, "validate_prompt", validate_prompt, raising=False)
    monkeypatch.setattr(stage_runs, "_execute_stage_run", execute_stage_run)
    monkeypatch.setattr(
        server.PromptServer.instance,
        "node_replace_manager",
        types.SimpleNamespace(apply_replacements=lambda prompt: None),
        raising=False,
    )
    stage_runs.ACTIVE_STAGE_RUNS.clear()

    app = web.Application()
    app.router.add_routes(server.PromptServer.instance.routes)
    test_client = TestClient(TestServer(app))
    await test_client.start_server()
    return test_client, stage_runs, gate


async def _close_client(test_client, stage_runs, gate):
    gate.set()
    await asyncio.sleep(0)
    for run in list(stage_runs.ACTIVE_STAGE_RUNS.values()):
        if run.task is not None:
            run.task.cancel()
    stage_runs.ACTIVE_STAGE_RUNS.clear()
    await test_client.close()


def test_start_and_cancel_stage_run(monkeypatch):
    async def run():
        test_client, stage_runs, gate = await _make_client(monkeypatch)
        try:
            response = await test_client.post("/comfytv/stage_runs", json={
                "prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
                "target_node_id": "7",
                "client_id": "tab-1",
                "stage_uid": "stage-uid-7",
            })
            assert response.status == 200
            body = await response.json()
            stage_run = stage_runs.ACTIVE_STAGE_RUNS[body["job_id"]]
            assert stage_run.node_id == "7"
            assert stage_run.client_id == "tab-1"
            assert stage_run.stage_uid == "stage-uid-7"

            cancelled = await test_client.post(
                f"/comfytv/stage_runs/{body['job_id']}/cancel",
            )
            assert cancelled.status == 200
            assert body["job_id"] not in stage_runs.ACTIVE_STAGE_RUNS
        finally:
            await _close_client(test_client, stage_runs, gate)

    asyncio.run(run())


def test_stage_run_rejects_missing_target(monkeypatch):
    async def run():
        test_client, stage_runs, gate = await _make_client(monkeypatch)
        try:
            response = await test_client.post("/comfytv/stage_runs", json={
                "prompt": {"1": {"class_type": "ComfyTV.ImageStage", "inputs": {}}},
                "target_node_id": "2",
            })
            assert response.status == 400
        finally:
            await _close_client(test_client, stage_runs, gate)

    asyncio.run(run())


def test_stage_run_rejects_non_comfytv_nodes(monkeypatch):
    async def run():
        test_client, stage_runs, gate = await _make_client(monkeypatch)
        try:
            response = await test_client.post("/comfytv/stage_runs", json={
                "prompt": {"1": {"class_type": "SaveImage", "inputs": {}}},
                "target_node_id": "1",
            })
            assert response.status == 400
        finally:
            await _close_client(test_client, stage_runs, gate)

    asyncio.run(run())


def test_safe_extra_data_whitelists_auth_and_workflow():
    from ComfyTV.api.stage_runs import _safe_extra_data

    assert _safe_extra_data({
        "extra_data": {
            "auth_token_comfy_org": " token ",
            "api_key_comfy_org": " key ",
            "ignored": "secret",
        },
        "workflow": {"nodes": []},
    }) == {
        "auth_token_comfy_org": "token",
        "api_key_comfy_org": "key",
        "extra_pnginfo": {"workflow": {"nodes": []}},
    }


def test_stage_run_server_rewrites_inner_progress(monkeypatch):
    from ComfyTV.api import stage_runs
    import server as server_module

    text_event = getattr(getattr(server_module, "BinaryEventTypes", None), "TEXT", 777)
    if not hasattr(server_module, "BinaryEventTypes"):
        monkeypatch.setattr(
            server_module,
            "BinaryEventTypes",
            types.SimpleNamespace(TEXT=text_event, PREVIEW_IMAGE_WITH_METADATA=778),
            raising=False,
        )

    sent = []
    monkeypatch.setattr(
        stage_runs,
        "send_prompt_server_sync",
        lambda event, data, sid=None: sent.append((event, data, sid)),
    )
    run = stage_runs.StageRun("job-1", "42", "client-1", "stage-uid-42")
    stage_server = stage_runs.StageRunServer(run)

    stage_server.send_sync("progress", {
        "value": 3,
        "max": 10,
        "node": "280",
        "prompt_id": "inner-1",
    })
    event, payload, sid = sent.pop(0)
    assert event == "progress"
    assert sid == "client-1"
    assert payload["node"] == "42"
    assert payload["node_id"] == "42"
    assert payload["nodeId"] == "42"
    assert payload["source_node"] == "280"
    assert payload["job_id"] == "job-1"
    assert payload["stage_uid"] == "stage-uid-42"

    text = "Waiting for server: 12s".encode("utf-8")
    inner_node = b"280"
    stage_server.send_sync(
        text_event,
        struct.pack(">I", len(inner_node)) + inner_node + text,
    )
    event, payload, sid = sent.pop(0)
    assert event == "progress_text"
    assert sid == "client-1"
    assert payload["nodeId"] == "42"
    assert payload["text"] == text.decode("utf-8")
    assert payload["stage_uid"] == "stage-uid-42"
