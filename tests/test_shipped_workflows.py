import json
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
