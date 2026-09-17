import json

from ComfyTV.runners._batch_loop import (
    BATCH_LOOP_CLASS,
    batch_loop_iterations,
    images_from_payload,
    merge_loop_payloads,
    prepare_iteration,
    workflow_has_batch_loop,
)


def test_no_loop_without_marker():
    cfg = {"api_json": {"1": {"class_type": "SaveImage", "inputs": {}}}}
    assert batch_loop_iterations(cfg, {"batch_size": 4}) == 1


def test_loop_reads_stage_batch_size():
    cfg = {"api_json": {"9": {"class_type": BATCH_LOOP_CLASS, "inputs": {"batch_size": 1}}}}
    assert workflow_has_batch_loop(cfg["api_json"])
    assert batch_loop_iterations(cfg, {"batch_size": 3}) == 3
    assert batch_loop_iterations(cfg, {"batch_size": 99}) == 8
    assert batch_loop_iterations(cfg, {"batch_size": 0}) == 1
    assert batch_loop_iterations(cfg, {}) == 1


def test_prepare_iteration_preserves_prompt():
    config = {
        "inputs": {
            "7": {"prompt": {"from": "main_prompt"}},
            "2": {"seed": {"from": "option:seed", "cast": "int"}},
        },
    }
    workflow = {
        "7": {"class_type": "GeminiNanoBanana2V2",
              "inputs": {"prompt": "a red cat", "seed": 10, "temperature": 1.0}},
        "2": {"class_type": "KSampler", "inputs": {"seed": 10}},
        "4": {"class_type": "SaveImage", "inputs": {"filename_prefix": "nb"}},
    }
    iter2 = prepare_iteration(workflow, config, 2)
    assert iter2["7"]["inputs"]["prompt"] == "a red cat"
    assert iter2["7"]["inputs"]["seed"] == 12
    assert iter2["7"]["inputs"]["temperature"] == 1.02
    assert workflow["7"]["inputs"]["prompt"] == "a red cat"
    assert workflow["7"]["inputs"]["temperature"] == 1.0


def test_prepare_iteration_reseeds_bound_and_bumps_unbound():
    config = {
        "inputs": {
            "2": {"seed": {"from": "option:seed", "cast": "int"}},
        },
    }
    workflow = {
        "2": {"class_type": "KSampler", "inputs": {"seed": 100}},
        "3": {"class_type": "KSampler", "inputs": {"seed": 50}},
        "4": {"class_type": "SaveImage", "inputs": {"filename_prefix": "nb"}},
        "9": {"class_type": BATCH_LOOP_CLASS, "inputs": {"batch_size": 3}},
    }
    iter0 = prepare_iteration(workflow, config, 0)
    assert iter0["2"]["inputs"]["seed"] == 100
    assert iter0["3"]["inputs"]["seed"] == 50
    assert iter0["4"]["inputs"]["filename_prefix"] == "nb"

    iter2 = prepare_iteration(workflow, config, 2)
    assert iter2["2"]["inputs"]["seed"] == 102
    assert iter2["3"]["inputs"]["seed"] == 52
    assert iter2["4"]["inputs"]["filename_prefix"] == "nb_b3"
    # original untouched
    assert workflow["2"]["inputs"]["seed"] == 100


def test_merge_single_urls_into_batch():
    out = json.loads(merge_loop_payloads(
        ["/view?filename=a.png&type=output", "/view?filename=b.png&type=output"],
        {"type": "ui_save_url"},
    ))
    assert [x["image_url"] for x in out["images"]] == [
        "/view?filename=a.png&type=output",
        "/view?filename=b.png&type=output",
    ]
    assert out["images"][1]["label"] == "#2"


def test_merge_batches_flatten():
    a = json.dumps({"images": [
        {"index": "1", "label": "#1", "image_url": "/view?filename=a.png&type=output"},
    ]})
    b = json.dumps({"images": [
        {"index": "1", "label": "#1", "image_url": "/view?filename=b.png&type=output"},
        {"index": "2", "label": "#2", "image_url": "/view?filename=c.png&type=output"},
    ]})
    out = json.loads(merge_loop_payloads([a, b], {"type": "ui_save_batch"}))
    assert len(out["images"]) == 3
    assert out["images"][2]["index"] == "3"


def test_merge_non_image_returns_last():
    out = merge_loop_payloads(["/view?filename=a.mp4&type=output",
                               "/view?filename=b.mp4&type=output"],
                              {"type": "ui_save_url"})
    # Still treated as image URLs by merge path for ui_save_url — both kept.
    # For multi type, last wins:
    last = merge_loop_payloads(["one", "two"], {"type": "multi"})
    assert last == "two"


def test_images_from_payload_variants():
    assert images_from_payload("/view?filename=x.png&type=output")[0]["image_url"].startswith("/view?")
    assert images_from_payload({"images": [{"image_url": "/view?f=1"}]})[0]["image_url"] == "/view?f=1"
    assert images_from_payload("not-json") == []


def test_local_runner_loops(monkeypatch):
    import asyncio

    from ComfyTV.runners import local_comfy as lc
    from ComfyTV.runners.base import RunnerContext

    calls: list[str] = []

    def fake_prepare(runner_id, kinds, ctx):
        cfg = {
            "api_json": {
                "1": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x"}},
                "9": {"class_type": BATCH_LOOP_CLASS, "inputs": {"batch_size": 1}},
            },
            "inputs": {},
            "result": {"type": "ui_save_url", "node": "1"},
        }
        wf = {
            "1": {"class_type": "SaveImage", "inputs": {"filename_prefix": "x"}},
            "9": {"class_type": BATCH_LOOP_CLASS, "inputs": {"batch_size": 3}},
        }
        return wf, {"type": "ui_save_url", "node": "1"}, cfg

    class FakeExec:
        def __init__(self):
            self.n = 0

        def reset(self):
            self.n += 1

    fake = FakeExec()

    async def fake_run(sub_prompt, sub_prompt_id, execute_outputs=None):
        calls.append(sub_prompt_id)
        return fake

    async def fake_extract(executor, result_meta):
        i = len(calls)
        return f"/view?filename={i}.png&type=output"

    monkeypatch.setattr(lc, "prepare_workflow", fake_prepare)
    monkeypatch.setattr(lc, "_run_subprompt", fake_run)
    monkeypatch.setattr(lc, "_extract_result", fake_extract)

    runner = lc.LocalComfyUIRunner("image/nb", "nb", {"image"})
    out = asyncio.run(runner.invoke(RunnerContext(
        kind="image", options={"batch_size": 3},
    )))
    data = json.loads(out)
    assert len(calls) == 3
    assert fake.n == 3
    assert len(data["images"]) == 3
