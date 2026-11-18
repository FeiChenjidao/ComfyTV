from __future__ import annotations

import asyncio
import json

import pytest


def test_ignis_image_runners_are_registered_for_image_stage():
    from ComfyTV.runners import RUNNER_REGISTRY
    from ComfyTV.runners.ignis_image import ignis_image_runners

    runners = ignis_image_runners()

    assert [runner.label for runner in runners] == [
        "Ignis Nano Banana Pro",
        "Ignis Seedream 5 Pro",
        "Ignis Nano Banana 2.1",
        "Ignis Midjourney",
        "Ignis Dreamina V3.1",
        "Ignis Z-image",
        "Ignis GPT Image 2.6",
        "Ignis Ideogram 4.5",
    ]
    assert all(runner.kinds == frozenset({"image"}) for runner in runners)
    assert all(
        RUNNER_REGISTRY.by_label(runner.label, "image") is not None
        for runner in runners
    )


def test_virtual_config_exposes_ratio_and_count_but_not_resolution():
    from ComfyTV.runners.ignis_image import IgnisImageRunner

    config = IgnisImageRunner("seedream").workflow_config()
    widgets = {item["widget_name"]: item for item in config["exposed_widgets"]}

    assert set(widgets) == {"aspect_ratio", "batch_size"}
    assert widgets["aspect_ratio"]["widget_props"]["values"] == [
        "auto", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16",
    ]
    assert widgets["batch_size"]["widget_props"] == {
        "min": 1,
        "max": 8,
        "step": 1,
    }
    assert config["meta"]["remote_provider"] == "ignis"
    assert config["meta"]["billing"] == "ignis_credits"
    assert config["meta"]["bound_only_params"] is True


def test_usage_hides_references_for_create_only_models():
    from ComfyTV.runners.ignis_image import IgnisImageRunner

    midjourney = IgnisImageRunner("midjourney").workflow_usage()
    ideogram = IgnisImageRunner("ideogram").workflow_usage()

    assert midjourney["uses"]["image"] is False
    assert midjourney["max_inputs"]["image"] == 0
    assert ideogram["uses"]["image"] is True
    assert ideogram["max_inputs"]["image"] == 5
    assert ideogram["uses_options"] == {
        "aspect_ratio": True,
        "batch_size": True,
    }
    assert ideogram["uses_mask"] is False


def test_batch_payload_repeats_complete_requests():
    from ComfyTV.runners.ignis_image import _build_payload, _build_request

    request = _build_request(
        model="gpt-image",
        prompt="paint a lighthouse",
        aspect_ratio="16:9",
        file_ids=["files/reference.png"],
    )
    payload = _build_payload(request, 3)

    assert payload == {"requests": [request, request, request]}
    assert payload["requests"][0] is not payload["requests"][1]


def test_create_only_model_rejects_reference_images():
    from ComfyTV.runners.ignis_image import _build_request

    with pytest.raises(RuntimeError, match="text-to-image"):
        _build_request(
            model="midjourney",
            prompt="a city at night",
            aspect_ratio="1:1",
            file_ids=["files/reference.png"],
        )


def test_ideogram_rejects_more_than_five_references():
    from ComfyTV.runners.ignis_image import _build_request

    with pytest.raises(RuntimeError, match="at most 5"):
        _build_request(
            model="ideogram",
            prompt="edit the first image",
            aspect_ratio="auto",
            file_ids=[f"files/{index}.png" for index in range(6)],
        )


def test_runner_rejects_mask_before_sending_request(monkeypatch):
    from ComfyTV.runners import ignis_image
    from ComfyTV.runners.base import RunnerContext

    called = False

    def fake_config():
        nonlocal called
        called = True
        return "https://ignis.example", "token"

    monkeypatch.setattr(ignis_image, "load_ignis_config", fake_config)
    runner = ignis_image.IgnisImageRunner("seedream")

    with pytest.raises(RuntimeError, match="mask input"):
        asyncio.run(runner.invoke(RunnerContext(
            kind="image",
            main_prompt="replace the sky",
            options={"mask_data": "mask.png", "batch_size": 1},
        )))
    assert called is False


def test_runner_uploads_references_and_keeps_partial_successes(monkeypatch, tmp_path):
    from ComfyTV.runners import _ignis, ignis_image
    from ComfyTV.runners.base import RunnerContext

    output_root = tmp_path / "output"
    reference = tmp_path / "reference.png"
    reference.write_bytes(b"reference")
    submitted = {}

    monkeypatch.setattr(
        ignis_image,
        "load_ignis_config",
        lambda: ("https://ignis.example", "token"),
    )
    monkeypatch.setattr(_ignis, "view_url_to_path", lambda _value: reference)
    monkeypatch.setattr(
        ignis_image.folder_paths,
        "get_output_directory",
        lambda: str(output_root),
    )
    monkeypatch.setattr(
        ignis_image.folder_paths,
        "get_directory_by_type",
        lambda _type: str(output_root),
    )

    async def fake_upload(self, session, path):
        assert path == reference
        return {"file_id": "files/reference.png"}

    async def fake_submit(self, session, payload):
        submitted.update(payload)
        return {
            "task_id": "task-1",
            "status": "completed",
            "result": {
                "successful": [{
                    "outputs": [
                        {"file_id": "outputs/one.png", "url": "https://cdn/one.png"},
                        {"file_id": "outputs/two.png", "url": "https://cdn/two.png"},
                    ],
                }],
                "failed": [{"message": "one request failed"}],
            },
        }

    async def fake_download(session, item, destination, *, media_label):
        assert media_label == "image"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(str(item["file_id"]).encode())

    monkeypatch.setattr(ignis_image.IgnisClient, "upload", fake_upload)
    monkeypatch.setattr(ignis_image.IgnisClient, "submit", fake_submit)
    monkeypatch.setattr(ignis_image, "download_media", fake_download)

    result = asyncio.run(ignis_image.IgnisImageRunner("ideogram").invoke(
        RunnerContext(
            kind="image",
            main_prompt="edit the poster",
            upstream={"images": ["/view?filename=reference.png&type=input"]},
            options={"aspect_ratio": "16:9", "batch_size": 2},
        )
    ))
    payload = json.loads(result)

    assert submitted == {
        "requests": [
            {
                "model": "ideogram",
                "prompt": "edit the poster",
                "aspect_ratio": "16:9",
                "file_ids": ["files/reference.png"],
            },
            {
                "model": "ideogram",
                "prompt": "edit the poster",
                "aspect_ratio": "16:9",
                "file_ids": ["files/reference.png"],
            },
        ]
    }
    assert len(payload["images"]) == 2
    assert all(item["image_url"].startswith("/view?") for item in payload["images"])
    assert payload["meta"] == {
        "provider": "ignis",
        "model": "ideogram",
        "request_count": 2,
        "result_count": 2,
        "failed_count": 1,
    }


def test_runner_raises_when_every_request_fails(monkeypatch):
    from ComfyTV.runners import ignis_image
    from ComfyTV.runners.base import RunnerContext

    monkeypatch.setattr(
        ignis_image,
        "load_ignis_config",
        lambda: ("https://ignis.example", "token"),
    )

    async def fake_submit(self, session, payload):
        return {
            "task_id": "task-failed",
            "status": "failed",
            "result": {
                "successful": [],
                "failed": [{"message": "insufficient credits"}],
            },
        }

    monkeypatch.setattr(ignis_image.IgnisClient, "submit", fake_submit)

    with pytest.raises(RuntimeError, match="insufficient credits"):
        asyncio.run(ignis_image.IgnisImageRunner("dreamina").invoke(
            RunnerContext(
                kind="image",
                main_prompt="a glass sculpture",
                options={"aspect_ratio": "1:1", "batch_size": 1},
            )
        ))


def test_missing_token_error_points_to_comfytv_settings(monkeypatch, tmp_path):
    from ComfyTV.runners import _ignis

    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.delenv("IGNIS_BASE_URL", raising=False)
    monkeypatch.delenv("MAI_BASE_URL", raising=False)
    monkeypatch.setattr(_ignis, "_plugin_root", lambda: tmp_path / "plugin")
    monkeypatch.setattr(_ignis.Path, "home", lambda: tmp_path)

    with pytest.raises(RuntimeError, match="ComfyTV Settings"):
        _ignis.load_ignis_config()
