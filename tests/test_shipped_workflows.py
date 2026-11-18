import json
import runpy
from pathlib import Path


WORKFLOWS_DIR = Path(__file__).resolve().parent.parent / "workflows"


def _shipped_json_paths() -> list[Path]:
    entries = []
    for raw in (WORKFLOWS_DIR / ".gitignore").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("!") and line.endswith(".json"):
            entries.append(WORKFLOWS_DIR / line[1:])
    return entries


def _node_ids(workflow: dict) -> set[str]:
    nodes = workflow.get("nodes")
    if isinstance(nodes, list):
        return {
            str(node["id"])
            for node in nodes
            if isinstance(node, dict) and node.get("id") is not None
        }
    return {
        str(node_id)
        for node_id, node in workflow.items()
        if isinstance(node, dict) and "class_type" in node
    }


def _top_node_id(node_id) -> str:
    return str(node_id).split(":", 1)[0]


def _bound_defaults(value, binding: str):
    if isinstance(value, dict):
        if value.get("from") == binding and "default" in value:
            yield value["default"]
        for child in value.values():
            yield from _bound_defaults(child, binding)
    elif isinstance(value, list):
        for child in value:
            yield from _bound_defaults(child, binding)


def test_shipped_workflows_and_presets_are_paired_and_valid():
    shipped = _shipped_json_paths()
    shipped_set = set(shipped)
    workflows = [
        path for path in shipped
        if not path.name.endswith("_preset.json")
        and not path.name.endswith(".api.json")
    ]
    presets = [path for path in shipped if path.name.endswith("_preset.json")]

    assert shipped
    for path in shipped:
        assert path.is_file(), f"shipped workflow entry is missing: {path}"
        json.loads(path.read_text(encoding="utf-8"))

    for workflow in workflows:
        preset = workflow.with_name(f"{workflow.stem}_preset.json")
        assert preset in shipped_set, f"shipped workflow has no preset entry: {workflow}"

    for preset in presets:
        workflow = preset.with_name(f"{preset.stem.removesuffix('_preset')}.json")
        assert workflow in shipped_set, f"shipped preset has no matching workflow: {preset}"


def test_shipped_preset_node_references_exist():
    for preset_path in _shipped_json_paths():
        if not preset_path.name.endswith("_preset.json"):
            continue
        workflow_path = preset_path.with_name(
            f"{preset_path.stem.removesuffix('_preset')}.json"
        )
        preset = json.loads(preset_path.read_text(encoding="utf-8"))
        workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
        node_ids = _node_ids(workflow)

        referenced: list[tuple[str, object]] = [
            ("input", node_id) for node_id in (preset.get("inputs") or {})
        ]
        result_node = (preset.get("result") or {}).get("node")
        if result_node is not None:
            referenced.append(("result", result_node))
        for rule in preset.get("prune_when_missing") or []:
            referenced.extend(("drop_node", node_id) for node_id in rule.get("drop_nodes") or [])
            for target in (rule.get("drop_inputs") or []) + (rule.get("drop_upstream_of") or []):
                referenced.append(("drop_target", target.get("node")))

        for source, node_id in referenced:
            assert _top_node_id(node_id) in node_ids, (
                f"{preset_path}: {source} references missing node {node_id}"
            )


def test_shipped_model_image_slot_roles_match_bindings():
    expected = {
        "meshy-multi_preset.json": ["front", "left", "back", "right"],
        "tripo_preset.json": ["front", "left", "back", "right"],
        "tripo-p2_preset.json": ["front", "left", "back", "right"],
        "rodin-gen25_preset.json": ["reference"] * 5,
    }
    for name, roles in expected.items():
        preset_path = WORKFLOWS_DIR / "model" / name
        preset = json.loads(preset_path.read_text(encoding="utf-8"))
        assert preset.get("meta", {}).get("model_image_slots") == roles

        bound_slots = set()
        for fields in (preset.get("inputs") or {}).values():
            for spec in fields.values():
                source = spec.get("from", "") if isinstance(spec, dict) else ""
                if source.startswith("upstream_image:annotated["):
                    bound_slots.add(int(source.rsplit("[", 1)[1].rstrip("]")))
        assert bound_slots == set(range(len(roles))), (
            f"{preset_path}: model_image_slots must match upstream image bindings"
        )


def test_shipped_model_versions_are_valid_stage_values():
    constants_path = (
        Path(__file__).resolve().parent.parent
        / "nodes" / "stages" / "common" / "constants.py"
    )
    allowed = set(runpy.run_path(str(constants_path))["MODEL3D_MODEL_VERSIONS"])
    current_meshy_versions = {"meshy-7.1", "meshy-7", "meshy-6", "latest"}

    assert current_meshy_versions <= allowed
    for preset_path in (WORKFLOWS_DIR / "model").glob("*_preset.json"):
        preset = json.loads(preset_path.read_text(encoding="utf-8"))
        for default in _bound_defaults(preset, "option:model_version"):
            assert default in allowed, (
                f"{preset_path}: model_version default {default!r} is rejected "
                "by ComfyTV.Model3DStage"
            )


def test_shipped_model_workflows_default_to_high_quality():
    def workflow(name: str) -> dict:
        path = WORKFLOWS_DIR / "model" / name
        return json.loads(path.read_text(encoding="utf-8"))

    def preset(name: str) -> dict:
        path = WORKFLOWS_DIR / "model" / name
        return json.loads(path.read_text(encoding="utf-8"))

    tripo = workflow("tripo.json")
    for node_id in (47, 48):
        node = next(node for node in tripo["nodes"] if node["id"] == node_id)
        assert node["widgets_values_named"]["texture_quality"] == "extreme"
        assert node["widgets_values_named"]["geometry_quality"] == "detailed"

    tripo_p2 = workflow("tripo-p2.json")
    for node_id in (47, 48):
        node = next(node for node in tripo_p2["nodes"] if node["id"] == node_id)
        assert node["widgets_values_named"]["model.texture"] == "extreme"
        assert node["widgets_values_named"]["model.face_limit"] == 50_000

    meshy = workflow("meshy-multi.json")
    for node_id in (1, 2):
        node = next(node for node in meshy["nodes"] if node["id"] == node_id)
        named = node["widgets_values_named"]
        assert named["should_remesh.target_polycount"] == 300_000
        assert named["should_texture.enable_pbr"] is True
        assert named["should_texture.texture_resolution"] == "8k"
        assert named["ultra_mode"] is True
    assert next(node for node in meshy["nodes"] if node["id"] == 2)[
        "widgets_values_named"
    ]["ultra_resolution"] == "4k"

    rodin = next(node for node in workflow("rodin-gen25.json")["nodes"] if node["id"] == 1)
    rodin_named = rodin["widgets_values_named"]
    assert rodin_named["mode"] == "Extreme-High"
    assert rodin_named["mode.mesh_faces"] == 2_000_000
    assert rodin_named["mode.is_micro"] is True
    assert rodin_named["texture_mode"] == "high"
    assert rodin_named["hd_texture"] is True
    assert rodin_named["addon_highpack"] is True
    assert rodin["widgets_values"][10:15] == [False, True, False, False, True]

    assert next(_bound_defaults(preset("tripo_preset.json"), "option:texture_quality")) == "extreme"
    assert next(_bound_defaults(preset("tripo_preset.json"), "option:geometry_quality")) == "detailed"
    assert next(_bound_defaults(preset("meshy-multi_preset.json"), "option:texture_resolution")) == "8k"
    assert next(_bound_defaults(preset("rodin-gen25_preset.json"), "option:mode")) == "Extreme-High"


def test_seedance_official_video_workflow_contract():
    workflow = json.loads(
        (WORKFLOWS_DIR / "video" / "seedance-2.5-official.json").read_text(
            encoding="utf-8"
        )
    )
    preset = json.loads(
        (WORKFLOWS_DIR / "video" / "seedance-2.5-official_preset.json").read_text(
            encoding="utf-8"
        )
    )

    assert {node["type"] for node in workflow["nodes"]} == {
        "LoadImage",
        "ByteDance2TextToVideoNode",
        "ByteDance2FirstLastFrameNode",
        "ComfySwitchNode",
        "SaveVideo",
    }
    nodes = {node["id"]: node for node in workflow["nodes"]}
    assert sum(node["type"] == "LoadImage" for node in workflow["nodes"]) == 2
    assert sum(
        node["type"] == "ByteDance2FirstLastFrameNode"
        for node in workflow["nodes"]
    ) == 2
    assert sum(node["type"] == "ComfySwitchNode" for node in workflow["nodes"]) == 2
    assert nodes[3]["inputs"][1]["link"] is None
    assert nodes[8]["inputs"][1]["link"] == 5
    assert preset["inputs"]["4"]["switch"]["cast"] == "transition_mode"
    assert preset["inputs"]["7"]["switch"]["cast"] == "bool"
    assert preset["inputs"]["2"]["model.resolution"]["cast"] == "lower"
    assert preset["meta"]["option_enums"]["mode"] == [
        "\u6587\u751f\u89c6\u9891", "\u56fe\u751f\u89c6\u9891", "\u9996\u5c3e\u5e27",
    ]
    assert preset["meta"]["option_enums"]["resolution"] == [
        "480P", "720P", "1080P", "4K",
    ]
    assert preset["inputs"]["1"]["image"] == {
        "from": "upstream_image:annotated[0]",
    }
    assert preset["inputs"]["6"]["image"] == {
        "from": "upstream_image:annotated[1]",
    }
