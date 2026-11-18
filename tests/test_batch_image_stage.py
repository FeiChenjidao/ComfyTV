from __future__ import annotations

import asyncio
import json


def test_batch_image_stage_runs_once_per_source(monkeypatch):
    from ComfyTV.nodes.stages import generators

    calls = []

    async def fake_invoke_runner(**kwargs):
        calls.append(kwargs)
        number = len(calls)
        return json.dumps({
            "images": [
                {"index": "1", "image_url": f"/view?filename=out-{number}-1.png"},
                {"index": "2", "image_url": f"/view?filename=out-{number}-2.png"},
            ]
        })

    monkeypatch.setattr(generators, "invoke_runner", fake_invoke_runner)
    monkeypatch.setattr(generators, "_emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        generators,
        "_stage_emit_auto",
        lambda cls, **kwargs: (kwargs["payload_str"], kwargs["picked_payload"]),
    )

    source = json.dumps({
        "images": [
            {"index": "1", "label": "Frame 1", "image_url": "/view?filename=frame-1.png"},
            {"index": "2", "label": "Frame 2", "image_url": "/view?filename=frame-2.png"},
            {"index": "3", "label": "Frame 3", "image_url": "/view?filename=frame-3.png"},
        ]
    })
    payload, picked = asyncio.run(
        generators.BatchImageStage.execute(
            workflow="Image Workflow",
            resolution="1K",
            aspect_ratio="16:9",
            outputs_per_image=2,
            start_index=2,
            max_items=2,
            main_prompt="restyle",
            images=source,
            selected_index=3,
        )
    )

    assert [call["upstream"]["images"] for call in calls] == [
        ["/view?filename=frame-2.png"],
        ["/view?filename=frame-3.png"],
    ]
    assert all(call["options"]["batch_size"] == 2 for call in calls)
    parsed = json.loads(payload)
    assert len(parsed["images"]) == 4
    assert parsed["images"][0]["source_index"] == "2"
    assert parsed["images"][2]["source_index"] == "3"
    assert picked == "/view?filename=out-2-1.png"


def test_batch_image_stage_can_continue_after_one_failure(monkeypatch):
    from ComfyTV.nodes.stages import generators

    calls = 0

    async def fake_invoke_runner(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("temporary failure")
        return json.dumps({
            "images": [{"index": "1", "image_url": "/view?filename=ok.png"}]
        })

    monkeypatch.setattr(generators, "invoke_runner", fake_invoke_runner)
    monkeypatch.setattr(generators, "_emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        generators,
        "_stage_emit_auto",
        lambda cls, **kwargs: (kwargs["payload_str"], kwargs["picked_payload"]),
    )

    source = json.dumps({
        "images": [
            {"index": "1", "image_url": "/view?filename=a.png"},
            {"index": "2", "image_url": "/view?filename=b.png"},
        ]
    })
    payload, picked = asyncio.run(
        generators.BatchImageStage.execute(
            workflow="Image Workflow",
            images=source,
            continue_on_error=True,
            max_items=0,
        )
    )

    parsed = json.loads(payload)
    assert parsed["meta"]["failed_count"] == 1
    assert parsed["meta"]["result_count"] == 1
    assert picked == "/view?filename=ok.png"
