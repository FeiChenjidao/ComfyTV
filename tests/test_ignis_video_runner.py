from __future__ import annotations

import asyncio
import json


def test_load_ignis_config_prefers_environment(monkeypatch, tmp_path):
    from ComfyTV.runners import _ignis

    monkeypatch.setenv("IGNIS_BASE_URL", "https://example.invalid/")
    monkeypatch.setenv("IGNIS_CLI_TOKEN", "env-token")
    monkeypatch.setattr(_ignis.Path, "home", lambda: tmp_path)

    assert _ignis.load_ignis_config() == (
        "https://example.invalid",
        "env-token",
    )


def test_load_ignis_config_reads_compatible_config(monkeypatch, tmp_path):
    from ComfyTV.runners import _ignis

    monkeypatch.delenv("IGNIS_BASE_URL", raising=False)
    monkeypatch.delenv("IGNIS_CLI_TOKEN", raising=False)
    monkeypatch.delenv("MAI_BASE_URL", raising=False)
    monkeypatch.delenv("MAI_CLI_TOKEN", raising=False)
    monkeypatch.setattr(_ignis, "_plugin_root", lambda: tmp_path / "plugin")
    monkeypatch.setattr(_ignis.Path, "home", lambda: tmp_path)
    config_dir = tmp_path / ".ignis"
    config_dir.mkdir()
    (config_dir / "config.json").write_text(
        json.dumps({"baseUrl": "https://ignis.example", "cliToken": "config-token"}),
        encoding="utf-8",
    )

    assert _ignis.load_ignis_config() == (
        "https://ignis.example",
        "config-token",
    )


def test_ignis_runners_are_video_stage_backends():
    from ComfyTV.runners.ignis_video import ignis_video_runners

    runners = ignis_video_runners()

    assert [runner.label for runner in runners] == [
        "Ignis Seedance 2.5",
        "Ignis Kling",
        "Ignis Sora",
        "Ignis PixVerse",
    ]
    assert all(runner.kinds == frozenset({"video"}) for runner in runners)


def test_seedance_virtual_config_exposes_matching_parameters():
    from ComfyTV.runners.ignis_video import IgnisVideoRunner

    config = IgnisVideoRunner("seedance-2-5").workflow_config()
    widgets = {
        item["widget_name"]: item for item in config["exposed_widgets"]
    }

    assert config["meta"]["bound_only_params"] is True
    assert set(widgets) == {"mode", "aspect_ratio", "resolution", "duration_s"}
    assert widgets["aspect_ratio"]["widget_props"]["values"][0] == "auto"
    assert widgets["resolution"]["widget_props"]["values"] == [
        "480P", "720P", "1080P",
    ]
    assert widgets["duration_s"]["widget_props"] == {
        "min": 4,
        "max": 30,
        "step": 1,
    }


def test_model_configs_only_expose_supported_parameters():
    from ComfyTV.runners.ignis_video import IgnisVideoRunner

    sora = IgnisVideoRunner("sora").workflow_config()
    kling = IgnisVideoRunner("kling").workflow_config()
    pixverse = IgnisVideoRunner("pixverse").workflow_config()

    assert [w["widget_name"] for w in sora["exposed_widgets"]] == [
        "mode", "aspect_ratio",
    ]
    assert [w["widget_name"] for w in kling["exposed_widgets"]] == ["mode"]
    assert [w["widget_name"] for w in pixverse["exposed_widgets"]] == ["mode"]


def test_virtual_configs_fit_video_stage_validation_contract():
    from ComfyTV.nodes.stages.generators import VideoStage
    from ComfyTV.runners.ignis_video import ignis_video_runners

    schema = VideoStage.define_schema().kw
    inputs = {item.args[0]: item for item in schema["inputs"] if item.args}
    input_names = [item.args[0] for item in schema["inputs"] if item.args]

    assert input_names.index("mode") > input_names.index("custom_params")

    allowed = {
        "mode": set(inputs["mode"].kw["options"]),
        "aspect_ratio": set(inputs["aspect_ratio"].kw["options"]),
        "resolution": set(inputs["resolution"].kw["options"]),
    }
    duration_min = inputs["duration_s"].kw["min"]
    duration_max = inputs["duration_s"].kw["max"]

    for runner in ignis_video_runners():
        widgets = {
            item["widget_name"]: item
            for item in runner.workflow_config()["exposed_widgets"]
        }
        for name, accepted in allowed.items():
            widget = widgets.get(name)
            if widget is None:
                continue
            assert set(widget["widget_props"]["values"]) <= accepted
        duration = widgets.get("duration_s")
        if duration is not None:
            assert duration_min <= duration["widget_props"]["min"]
            assert duration["widget_props"]["max"] <= duration_max


def test_build_payload_routes_omni_references():
    from ComfyTV.runners.ignis_video import _build_payload

    payload = _build_payload(
        prompt="follow the references",
        model="seedance-2-5",
        mode="omni",
        aspect_ratio="auto",
        resolution="1080P",
        duration_s=8,
        file_ids=["files/image.png"],
        tail_file_ids=[],
        video_urls=["files/video.mp4"],
        audio_urls=["files/audio.mp3"],
    )

    assert payload["file_ids"] == ["files/image.png"]
    assert payload["video_urls"] == ["files/video.mp4"]
    assert payload["audio_urls"] == ["files/audio.mp3"]
    assert payload["aspect_ratio"] == "adaptive"
    assert payload["resolution"] == "1080p"


def test_build_payload_recovers_stale_model_options():
    from ComfyTV.runners.ignis_video import _build_payload

    payload = _build_payload(
        prompt="recover stale values",
        model="seedance-2-5",
        mode="720P",
        aspect_ratio="invalid-ratio",
        resolution="8K",
        duration_s=0,
        file_ids=[],
        tail_file_ids=[],
        video_urls=[],
        audio_urls=[],
    )

    assert payload["aspect_ratio"] == "16:9"
    assert payload["resolution"] == "720p"
    assert payload["duration"] == 5


def test_invalid_mode_is_inferred_from_connected_materials():
    from ComfyTV.runners.ignis_video import (
        IGNIS_VIDEO_SPECS,
        MODE_IMAGE,
        MODE_OMNI,
        MODE_TRANSITION,
        _resolve_mode,
    )

    spec = IGNIS_VIDEO_SPECS["seedance-2-5"]

    assert _resolve_mode(spec, "invalid", images=1) == MODE_IMAGE
    assert _resolve_mode(spec, "invalid", images=2) == MODE_TRANSITION
    assert _resolve_mode(spec, "invalid", images=1, videos=1) == MODE_OMNI


def test_runner_builds_transition_payload(monkeypatch, tmp_path):
    from ComfyTV.runners import _ignis, ignis_video
    from ComfyTV.runners.base import RunnerContext

    output_root = tmp_path / "output"
    start = tmp_path / "start.png"
    end = tmp_path / "end.png"
    start.write_bytes(b"start")
    end.write_bytes(b"end")

    monkeypatch.setattr(
        ignis_video,
        "load_ignis_config",
        lambda: ("https://ignis.example", "token"),
    )
    monkeypatch.setattr(
        _ignis,
        "view_url_to_path",
        lambda value: start if "start" in value else end,
    )
    monkeypatch.setattr(
        ignis_video.folder_paths,
        "get_output_directory",
        lambda: str(output_root),
    )
    monkeypatch.setattr(
        ignis_video.folder_paths,
        "get_directory_by_type",
        lambda _type: str(output_root),
    )

    uploads = iter([
        {"file_id": "files/start.png", "file_type": "image"},
        {"file_id": "files/end.png", "file_type": "image"},
    ])
    submitted = {}

    async def fake_upload(self, session, path):
        return next(uploads)

    async def fake_submit(self, session, payload):
        submitted.update(payload)
        return {
            "task_id": "task-1",
            "status": "completed",
            "result": {
                "successful": [{
                    "file_id": "outputs/video.mp4",
                    "url": "https://cdn.example/video.mp4",
                }],
                "failed": [],
            },
        }

    async def fake_download(session, item, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"video")

    monkeypatch.setattr(ignis_video._IgnisClient, "upload", fake_upload)
    monkeypatch.setattr(ignis_video._IgnisClient, "submit", fake_submit)
    monkeypatch.setattr(ignis_video, "_download_video", fake_download)

    runner = ignis_video.IgnisVideoRunner("seedance-2-5")
    result = asyncio.run(runner.invoke(RunnerContext(
        kind="video",
        main_prompt="camera pushes in",
        upstream={
            "images": [
                "/view?filename=start.png&type=input",
                "/view?filename=end.png&type=input",
            ],
        },
        options={
            "mode": ignis_video.MODE_TRANSITION,
            "aspect_ratio": "16:9",
            "resolution": "720P",
            "duration_s": 5,
        },
    )))

    assert result.startswith("/view?")
    assert submitted["file_ids"] == ["files/start.png"]
    assert submitted["tail_file_ids"] == ["files/end.png"]
    assert submitted["model"] == "seedance-2-5"
    assert submitted["resolution"] == "720p"
