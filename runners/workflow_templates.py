"""Portable template state, separate from ordinary Ctrl+S persistence."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import re
from uuid import uuid4


WORKFLOW_ALIASES = {
    "ComfyTV.ImageStage": {
        "NanoBanana2": "NanoBanana 2.1",
        "GPT_Image_2.5": "GPT_Image_2.6",
    },
    "ComfyTV.Model3DStage": {"Meshy": "Meshy Multi"},
}
_CONTROLS = {"fixed", "increment", "decrement", "randomize"}


def workflow_nodes(graph: dict):
    yield from (node for node in graph.get("nodes", []) if isinstance(node, dict))
    for subgraph in (graph.get("definitions") or {}).get("subgraphs", []):
        if isinstance(subgraph, dict):
            yield from workflow_nodes(subgraph)


def _widget_names(schema: dict, values: list) -> list[str]:
    names = []
    inputs = schema.get("input", {})
    for section in ("required", "optional"):
        specs = inputs.get(section, {})
        for name in schema.get("input_order", {}).get(section, list(specs)):
            spec = specs.get(name)
            if not isinstance(spec, (tuple, list)) or not spec:
                continue
            kind = spec[0]
            opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            if opts.get("forceInput"):
                continue
            if not isinstance(kind, (list, tuple)) and kind not in (
                "INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COMPOSITOR",
            ):
                continue
            names.append(name)
            index = len(names)
            if (name in ("seed", "noise_seed") or opts.get("control_after_generate")) and (
                index < len(values) and isinstance(values[index], str)
                and values[index] in _CONTROLS
            ):
                names.append("control_after_generate")
    return names


def prepare_template_graph(graph: dict, schemas: dict, *, new_instance: bool = False) -> dict:
    result = deepcopy(graph)
    claimed_at = datetime.now(timezone.utc).isoformat()
    if new_instance:
        result["id"] = str(uuid4())
        result["revision"] = 0
    for node in workflow_nodes(result):
        cls = str(node.get("type", ""))
        if not cls.startswith("ComfyTV."):
            continue
        properties = node.setdefault("properties", {})
        properties.pop("comfytv_stage_uid", None)
        properties.pop("comfytv_stage_uid_at", None)
        if new_instance:
            properties["comfytv_stage_uid"] = str(uuid4())
            properties["comfytv_stage_uid_at"] = claimed_at
        values = node.get("widgets_values")
        named = node.get("widgets_values_named")
        if not isinstance(values, list) or not values:
            continue

        # Before model history was added, custom_params followed captured_image.
        if cls == "ComfyTV.Model3DStage" and 28 < len(values) <= 31 and not (
            isinstance(named, dict) and "selected_index" in named
        ):
            custom = values[28]
            if isinstance(custom, str) and custom.lstrip().startswith("{"):
                try:
                    is_custom = isinstance(json.loads(custom), dict)
                except json.JSONDecodeError:
                    is_custom = False
                if is_custom:
                    values[28:28] = [1, "", True]

        if cls in WORKFLOW_ALIASES and len(values) > 3 and isinstance(values[3], str):
            values[3] = WORKFLOW_ALIASES[cls].get(values[3], values[3])
            if isinstance(named, dict) and isinstance(named.get("workflow"), str):
                named["workflow"] = WORKFLOW_ALIASES[cls].get(named["workflow"], named["workflow"])

        names = _widget_names(schemas.get(cls, {}), values)
        for index, name in enumerate(names):
            if index >= len(values):
                break
            if name in ("force_run_token", "parent_output_id", "asset_id"):
                values[index] = 0
            elif name == "project_id":
                values[index] = ""
            elif cls == "ComfyTV.Model3DStage" and name == "seed" and values[index] is None:
                values[index] = 0
            elif cls == "ComfyTV.Model3DStage" and name == "append_results" and not isinstance(values[index], bool):
                values[index] = True
            elif name == "category" and cls.startswith("ComfyTV.Asset"):
                values[index] = "all"
            elif name == "psd_file" and isinstance(values[index], str) and (
                re.match(r"^[A-Za-z]:[\\/]", values[index]) or values[index].startswith(("/", "\\\\"))
            ) and not values[index].startswith("/view?"):
                # PSD sources can be hundreds of MB. Keep the exported layers;
                # editing the source on another computer requires selecting it.
                values[index] = ""
            if isinstance(named, dict) and name in named and name in (
                "force_run_token", "parent_output_id", "asset_id", "project_id", "category", "psd_file", "seed", "append_results",
            ):
                named[name] = values[index]

        # Generated model history is local; model files are deliberately not
        # distributed with templates. Loader models and editor state stay intact.
        if cls == "ComfyTV.Model3DStage":
            for name, value in (("selected_index", 1), ("pool", ""), ("captured_image", "")):
                if name in names and names.index(name) < len(values):
                    values[names.index(name)] = value
                    if isinstance(named, dict) and name in named:
                        named[name] = value
    return result
