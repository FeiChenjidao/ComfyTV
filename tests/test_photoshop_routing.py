import asyncio
import json

from ComfyTV.photoshop import backend


class FakeSocket:
    def __init__(self):
        self.messages = []

    async def send_str(self, value):
        self.messages.append(json.loads(value))


def reset_state():
    backend.clients.clear()
    backend.photoshop_users.clear()
    backend.comfyui_users.clear()
    backend.photoshop_bindings.clear()
    backend.active_jobs.clear()


def add_client(client_id, platform, ready=False):
    socket = FakeSocket()
    backend.clients[client_id] = {
        "ws": socket,
        "platform": platform,
        "ready": ready,
        "workflow_fingerprint": "test",
        "protocol_version": 3,
    }
    (backend.photoshop_users if platform == "ps" else backend.comfyui_users).append(client_id)
    return socket


def test_queue_binds_to_latest_ready_comfy_client():
    async def run():
        reset_state()
        add_client("ps", "ps")
        first = add_client("cm-first", "cm", ready=True)
        second = add_client("cm-second", "cm", ready=True)
        await backend.handle_message("ps", "ps", json.dumps({
            "queue": True,
            "jobId": "job-1",
            "batchIndex": 2,
            "referenceCount": 3,
        }))
        assert first.messages == []
        assert second.messages[-1]["jobId"] == "job-1"
        assert second.messages[-1]["psClientId"] == "ps"
        assert backend.active_jobs["job-1"]["cm_client_id"] == "cm-second"

    asyncio.run(run())


def test_embedded_comfy_client_is_preferred_for_its_photoshop_panel():
    async def run():
        reset_state()
        add_client("ps", "ps")
        embedded = add_client("cm-embedded", "cm")
        other = add_client("cm-other", "cm", ready=True)
        await backend.handle_message("cm-embedded", "cm", json.dumps({
            "bridgeHello": {
                "protocolVersion": 3,
                "ready": True,
                "workflowFingerprint": "embedded",
                "psClientId": "ps",
            },
        }))
        await backend.handle_message("ps", "ps", json.dumps({
            "queue": True,
            "jobId": "job-preferred",
        }))
        assert embedded.messages[-1]["jobId"] == "job-preferred"
        assert other.messages == []
        assert backend.photoshop_bindings["ps"] == "cm-embedded"

    asyncio.run(run())


def test_job_status_returns_only_to_owning_photoshop_client():
    async def run():
        reset_state()
        owner = add_client("ps-owner", "ps")
        other = add_client("ps-other", "ps")
        add_client("cm", "cm", ready=True)
        backend.active_jobs["job-2"] = {"ps_client_id": "ps-owner", "cm_client_id": "cm"}
        await backend.handle_message("cm", "cm", json.dumps({
            "jobId": "job-2",
            "jobStatus": {"phase": "error", "message": "failed"},
        }))
        assert owner.messages[-1]["jobId"] == "job-2"
        assert other.messages == []
        assert "job-2" not in backend.active_jobs

    asyncio.run(run())


def test_stale_job_message_is_not_broadcast_to_other_photoshop_clients():
    async def run():
        reset_state()
        first = add_client("ps-first", "ps")
        second = add_client("ps-second", "ps")
        add_client("cm", "cm", ready=True)
        await backend.handle_message("cm", "cm", json.dumps({
            "jobId": "expired-job",
            "jobStatus": {"phase": "completed", "progress": 100},
        }))
        assert first.messages == []
        assert second.messages == []

    asyncio.run(run())


def test_photoshop_completion_ack_finishes_and_clears_job():
    async def run():
        reset_state()
        owner = add_client("ps-owner", "ps")
        comfy = add_client("cm", "cm", ready=True)
        backend.active_jobs["job-done"] = {
            "ps_client_id": "ps-owner",
            "cm_client_id": "cm",
        }
        await backend.handle_message("ps-owner", "ps", json.dumps({
            "jobId": "job-done",
            "jobAck": {"phase": "completed"},
        }))
        assert comfy.messages[-1]["jobAck"]["phase"] == "completed"
        assert owner.messages[-1]["jobStatus"]["phase"] == "completed"
        assert "job-done" not in backend.active_jobs

    asyncio.run(run())


def test_stale_render_is_dropped_while_another_job_is_active(tmp_path, monkeypatch):
    async def run():
        reset_state()
        owner = add_client("ps-owner", "ps")
        add_client("cm", "cm", ready=True)
        backend.active_jobs["job-current"] = {
            "ps_client_id": "ps-owner",
            "cm_client_id": "cm",
        }
        (tmp_path / "render.png").write_bytes(b"render")
        monkeypatch.setattr(backend.folder_paths, "get_temp_directory", lambda: str(tmp_path))
        monkeypatch.setattr(backend, "thumb_png_base64", lambda _path: "thumb")
        await backend.send_render_file("render.png", "job-stale")
        assert owner.messages == []
        assert "job-current" in backend.active_jobs

    asyncio.run(run())


def test_manual_render_is_marked_and_only_sent_without_active_jobs(tmp_path, monkeypatch):
    async def run():
        reset_state()
        owner = add_client("ps-owner", "ps")
        (tmp_path / "render.png").write_bytes(b"render")
        monkeypatch.setattr(backend.folder_paths, "get_temp_directory", lambda: str(tmp_path))
        monkeypatch.setattr(backend, "thumb_png_base64", lambda _path: "thumb")
        await backend.send_render_file("render.png", "old-job")
        message = owner.messages[-1]
        assert message["jobId"] == ""
        assert message["manualRender"] is True

    asyncio.run(run())


def test_layered_render_is_sent_only_to_the_owning_photoshop_client():
    async def run():
        reset_state()
        owner = add_client("ps-owner", "ps")
        other = add_client("ps-other", "ps")
        add_client("cm", "cm", ready=True)
        backend.active_jobs["job-layered"] = {
            "ps_client_id": "ps-owner",
            "cm_client_id": "cm",
        }
        layered = {
            "canvas": {"width": 1024, "height": 1024},
            "layers": [{"name": "subject", "base64": "layer"}],
        }
        payload = await backend.send_render_payload("preview", "job-layered", "thumb", layered)
        assert payload["layered"] == layered
        assert owner.messages[-1]["layered"] == layered
        assert other.messages == []

    asyncio.run(run())


def test_mask_clear_removes_previous_mask(tmp_path, monkeypatch):
    async def run():
        reset_state()
        monkeypatch.setattr(backend, "PS_INPUTS", str(tmp_path))
        mask = tmp_path / "PS_mask.png"
        mask.write_bytes(b"stale-mask")
        add_client("ps", "ps")
        await backend.handle_message("ps", "ps", json.dumps({"maskClear": True}))
        assert not mask.exists()

    asyncio.run(run())


def test_legacy_migration_does_not_restore_a_stale_mask(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy"
    target = tmp_path / "target"
    legacy.mkdir()
    target.mkdir()
    (legacy / "config.json").write_text('{"hasMask": false}', encoding="utf-8")
    (legacy / "PS_canvas.png").write_bytes(b"canvas")
    (legacy / "PS_mask.png").write_bytes(b"stale-mask")
    monkeypatch.setattr(backend, "LEGACY_PS_INPUTS", str(legacy))
    monkeypatch.setattr(backend, "PS_INPUTS", str(target))
    backend.migrate_legacy_inputs()
    assert (target / "config.json").exists()
    assert (target / "PS_canvas.png").exists()
    assert not (target / "PS_mask.png").exists()
