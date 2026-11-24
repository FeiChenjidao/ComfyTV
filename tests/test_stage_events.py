import asyncio
import json
import types

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


def test_view_ref_reads_comfyui_view_urls():
    from ComfyTV.nodes.stages.common.emit import _view_ref

    assert _view_ref("/view?filename=a.png&subfolder=comfytv%2Fx&type=output") == {
        "filename": "a.png",
        "subfolder": "comfytv/x",
        "type": "output",
        "url": "/view?filename=a.png&subfolder=comfytv%2Fx&type=output",
    }
    assert _view_ref("https://example.invalid/a.png") is None
    assert _view_ref("/view?subfolder=x") is None
    assert _view_ref(None) is None


def test_standard_refs_cover_batches_and_the_picked_image():
    from ComfyTV.nodes.stages.common.emit import _standard_output_refs

    payload = json.dumps({"images": [
        {"index": "1", "image_url": "/view?filename=a.png&type=output"},
        {"index": "2", "image_url": "/view?filename=b.png&type=output"},
    ]})
    refs = _standard_output_refs("images", payload, "/view?filename=b.png&type=output")
    assert [r["filename"] for r in refs["images"]] == ["b.png", "a.png"]


def test_standard_refs_keep_a_single_url_and_skip_unknown_types():
    from ComfyTV.nodes.stages.common.emit import _standard_output_refs

    assert _standard_output_refs("video", "/view?filename=c.mp4&type=output") == {
        "videos": [{
            "filename": "c.mp4",
            "subfolder": "",
            "type": "output",
            "url": "/view?filename=c.mp4&type=output",
        }],
    }
    # A storyboard payload is JSON text, not a file.
    assert _standard_output_refs("storyboard", "{}") == {}
    assert _standard_output_refs("images", "not a url") == {}


def test_broadcast_marks_the_event_external(monkeypatch):
    from ComfyTV.runners import stage_events
    import server as server_module

    sent = []
    monkeypatch.setattr(
        server_module.PromptServer.instance, "send_sync",
        lambda event, data, sid=None: sent.append((event, data, sid)), raising=False,
    )
    stage_events.broadcast_stage_run(
        node_id=7, ui={"output": ["x"]}, project_id="default",
        stage_uid="uid-7", prompt_id="prompt-1",
    )
    event, payload, sid = sent[0]
    assert event == "comfytv-stage-run"
    assert sid is None  # broadcast, not a reply to one client
    assert payload == {
        "node_id": "7",
        "status": "done",
        "external": True,
        "ui": {"output": ["x"]},
        "project_id": "default",
        "stage_uid": "uid-7",
        "prompt_id": "prompt-1",
    }


def test_broadcast_skips_runs_without_a_node_id(monkeypatch):
    from ComfyTV.runners import stage_events
    import server as server_module

    sent = []
    monkeypatch.setattr(
        server_module.PromptServer.instance, "send_sync",
        lambda *a, **k: sent.append(a), raising=False,
    )
    stage_events.broadcast_stage_run(node_id=None)
    stage_events.broadcast_stage_run(node_id="")
    assert sent == []


def test_stage_uid_comes_from_the_prompt_workflow():
    from ComfyTV.runners import stage_events

    cls = types.SimpleNamespace(hidden=types.SimpleNamespace(extra_pnginfo={
        "workflow": {"nodes": [
            {"id": 3, "properties": {"comfytv_stage_uid": "uid-3"}},
        ]},
    }))
    assert stage_events.stage_uid_from_hidden(cls, 3) == "uid-3"
    assert stage_events.stage_uid_from_hidden(cls, 9) is None
    assert stage_events.stage_uid_from_hidden(object(), 3) is None
