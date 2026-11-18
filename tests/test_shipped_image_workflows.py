import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _workflow(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def _node(workflow: dict, node_id: int) -> dict:
    return next(node for node in workflow["nodes"] if node["id"] == node_id)


def _assert_link_slots_match_inputs(workflow: dict, node: dict) -> None:
    links = {link[0]: link for link in workflow["links"]}
    for slot, node_input in enumerate(node.get("inputs", [])):
        link_id = node_input.get("link")
        if link_id is None:
            continue
        link = links[link_id]
        assert link[3] == node["id"]
        assert link[4] == slot


def test_gpt_image_workflow_uses_v3_and_batch_loop() -> None:
    workflow = _workflow("workflows/image/GPT_Image_2.6.json")
    node = _node(workflow, 280)

    assert node["type"] == "OpenAIGPTImageNodeV3"
    assert node["widgets_values_named"]["model"] == "gpt-image-2.6-flare"
    assert node["widgets_values_named"]["model.complexity"] == "high"
    assert any(item["type"] == "ComfyTV.BatchLoop" for item in workflow["nodes"])
    _assert_link_slots_match_inputs(workflow, node)


def test_photoshop_workflows_use_current_image_models() -> None:
    for relative_path in (
        "workflows/image/PS_NanoBanana_GPTImage.json",
        "dist/PS_NanoBanana_GPTImage.json",
    ):
        workflow = _workflow(relative_path)
        nano = _node(workflow, 3)
        gpt = _node(workflow, 24)

        assert nano["widgets_values_named"]["model"] == "Gemini Nano Banana 2.1"
        assert nano["widgets_values_named"]["model.thinking_level"] == "MEDIUM"
        assert gpt["type"] == "OpenAIGPTImageNodeV3"
        assert gpt["widgets_values_named"]["model"] == "gpt-image-2.6-flare"
        _assert_link_slots_match_inputs(workflow, gpt)


def test_photoshop_workflow_is_hidden_from_image_stage() -> None:
    preset = _workflow("workflows/image/PS_NanoBanana_GPTImage_preset.json")
    assert preset["label"] == "PS_NanoBanana_GPTImage"
    assert preset["is_hidden"] is True


def test_seedream_5_5_workflow_uses_stage_sizing_and_batch_loop() -> None:
    workflow = _workflow("workflows/image/Seedream_5.5.json")
    preset = _workflow("workflows/image/Seedream_5.5_preset.json")
    node = _node(workflow, 280)

    assert node["type"] == "ByteDanceSeedreamNodeV3"
    assert node["widgets_values_named"]["model"] == "seedream 5.5"
    assert node["widgets_values_named"]["model.size_preset"] == "Custom"
    assert preset["sizing"]["min_pixels"] == 921_600
    assert preset["sizing"]["max_pixels"] == 4_624_220
    assert preset["inputs"]["280"]["model.width"]["from"] == "computed:width"
    assert preset["inputs"]["280"]["model.height"]["from"] == "computed:height"
    assert len(preset["prune_when_missing"]) == 3
    assert any(item["type"] == "ComfyTV.BatchLoop" for item in workflow["nodes"])
    _assert_link_slots_match_inputs(workflow, node)


def test_gpt_inpaint_keeps_mask_node_and_uses_2_6() -> None:
    workflow = _workflow("workflows/inpaint/GPT局部重绘.json")
    node = _node(workflow, 10)

    assert node["type"] == "OpenAIGPTImageNodeV2"
    assert node["widgets_values_named"]["model"] == "gpt-image-2.6-flare"
    assert node["widgets_values_named"]["model.complexity"] == "high"
    assert any(item["name"] == "model.mask" for item in node["inputs"])
    _assert_link_slots_match_inputs(workflow, node)


def test_nanobanana_workflows_default_to_2_1() -> None:
    for relative_path, node_id in (
        ("workflows/image/NanoBanana2.json", 17),
        ("workflows/inpaint/Nanobanana 局部重绘.json", 101),
    ):
        node = _node(_workflow(relative_path), node_id)
        assert node["widgets_values_named"]["model"] == "Gemini Nano Banana 2.1"
        assert node["widgets_values_named"]["model.thinking_level"] == "MEDIUM"
