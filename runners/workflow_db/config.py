import json
import logging
import os
from typing import Any, Optional

from sqlalchemy import select

from ... import db
from .._workflow_resolve import OUTPUT_BINDING_PREFIX
from .bindings import drop_stale_api


_log = logging.getLogger(__name__)


def _bindings_to_inputs_dict(rows: list[db.WorkflowInputBinding]) -> dict:
    out: dict[str, dict[str, dict]] = {}
    for r in rows:
        spec: dict[str, Any] = {"from": r.from_}
        if r.default_value is not None:
            spec["default"] = r.default_value
        if r.prefix:    spec["prefix"]   = r.prefix
        if r.suffix:    spec["suffix"]   = r.suffix
        if r.required:  spec["required"] = True
        if r.error_msg: spec["error"]    = r.error_msg
        if r.cast_:     spec["cast"]     = r.cast_
        out.setdefault(r.node_id, {})[r.input_name] = spec
    return out


def build_preset(kind: str, label: str) -> Optional[dict]:
    db.init()
    with db.get_session() as s:
        row = s.execute(
            select(db.Workflow).where(db.Workflow.kind == kind, db.Workflow.label == label)
        ).scalar_one_or_none()
        if row is None:
            return None
        bindings = s.execute(
            select(db.WorkflowInputBinding)
            .where(db.WorkflowInputBinding.workflow_id == row.id)
            .order_by(db.WorkflowInputBinding.node_id, db.WorkflowInputBinding.input_name)
        ).scalars().all()

        out: dict[str, Any] = {
            "_comment": (
                f"Exported preset for the '{label}' workflow (kind={kind}). "
                f"Drop this next to the workflow JSON as "
                f"`<name>_preset.json` so other users' first-seed picks up "
                f"these defaults. See docs/custom-workflows.md."
            ),
            "label": row.label,
        }
        if row.order_ is not None and row.order_ != 100:
            out["order"] = row.order_
        if getattr(row, "is_default", False):
            out["is_default"] = True
        if row.description:
            out["description"] = row.description
        if row.result_node:
            out["result"] = {"type": row.result_type, "node": row.result_node}
        if row.sizing_json:
            try:
                sizing = json.loads(row.sizing_json)
                if sizing: out["sizing"] = sizing
            except json.JSONDecodeError:
                pass
        if row.prune_when_missing_json:
            try:
                prune = json.loads(row.prune_when_missing_json)
                if prune: out["prune_when_missing"] = prune
            except json.JSONDecodeError:
                pass
        if row.meta_json:
            try:
                meta = json.loads(row.meta_json)
                if meta: out["meta"] = meta
            except json.JSONDecodeError:
                pass
        if bindings:
            out["inputs"] = _bindings_to_inputs_dict(list(bindings))
        return out


def get_workflow_for_invoke(kind: str, label: str) -> Optional[dict]:
    db.init()
    with db.get_session() as s:
        row = s.execute(
            select(db.Workflow).where(db.Workflow.kind == kind, db.Workflow.label == label)
        ).scalar_one_or_none()
        if row is None:
            return None
        drop_stale_api(s, row)
        api_obj: Optional[dict] = None
        if row.api_json:
            try:
                api_obj = json.loads(row.api_json)
            except json.JSONDecodeError:
                api_obj = None
        if api_obj is None:
            from .convert import convert_row
            try:
                api_obj = convert_row(s, row)["api_json"]
            except Exception as e:
                raise RuntimeError(
                    f"Workflow {kind!r}/{label!r} could not be converted to "
                    f"API format: {e}"
                )
        bindings = s.execute(
            select(db.WorkflowInputBinding)
            .where(db.WorkflowInputBinding.workflow_id == row.id)
        ).scalars().all()

        return {
            "api_json": api_obj,
            "result": {"type": row.result_type, "node": row.result_node}
                      if row.result_node else {},
            "inputs": _bindings_to_inputs_dict(bindings),
            "sizing": json.loads(row.sizing_json) if row.sizing_json else {},
            "prune_when_missing":
                json.loads(row.prune_when_missing_json)
                if row.prune_when_missing_json else [],
            "meta": json.loads(row.meta_json) if row.meta_json else {},
        }


def _node_widget_meta(class_type: str) -> list[dict]:
    import nodes
    cls = (
        getattr(nodes, "NODE_CLASS_MAPPINGS", {}).get(class_type)
        if hasattr(nodes, "NODE_CLASS_MAPPINGS") else None
    )
    if cls is None:
        return []
    out: list[dict] = []

    _WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN"}
    input_types = None
    if hasattr(cls, "INPUT_TYPES"):
        try:
            input_types = cls.INPUT_TYPES()
        except Exception as e:
            _log.warning("[ComfyTV/workflow_db] INPUT_TYPES() raised for %s: %s",
                         class_type, e)

    for section in ("required", "optional"):
        for name, spec in ((input_types or {}).get(section) or {}).items():
            if not spec:
                continue
            if isinstance(spec, (list, tuple)):
                t = spec[0] if spec else None
                opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
                if isinstance(t, (list, tuple)):
                    out.append({
                        "name": name, "type": "COMBO",
                        "options": {"values": list(t), **(opts or {})},
                    })
                elif isinstance(t, str) and t.upper() == "COMBO":
                    values = opts.get("options")
                    if values is None:
                        values = opts.get("values")
                    out.append({
                        "name": name, "type": "COMBO",
                        "options": {**(opts or {}), "values": list(values or [])},
                    })
                elif isinstance(t, str) and t.upper() in _WIDGET_TYPES:
                    out.append({"name": name, "type": t.upper(), "options": opts})
            elif isinstance(spec, str) and spec.upper() in _WIDGET_TYPES:
                out.append({"name": name, "type": spec.upper(), "options": {}})

    define_schema = getattr(cls, "define_schema", None)
    if not callable(define_schema):
        return out
    try:
        schema = define_schema()
    except Exception as e:
        _log.warning("[ComfyTV/workflow_db] define_schema() raised for %s: %s",
                     class_type, e)
        return out

    def expand_input(inp, prefix: str = "",
                     dynamic_parent: str | None = None,
                     dynamic_when: list[str] | None = None):
        name = getattr(inp, "id", None)
        if not name:
            return
        full_name = f"{prefix}.{name}" if prefix else str(name)
        yield inp, full_name, dynamic_parent, dynamic_when
        io_type = getattr(inp, "get_io_type", lambda: None)()
        if io_type != "COMFY_DYNAMICCOMBO_V3":
            return
        for option in getattr(inp, "options", ()) or ():
            opt_key = getattr(option, "key", None)
            if opt_key is None:
                continue
            for child in getattr(option, "inputs", ()) or ():
                yield from expand_input(
                    child, full_name,
                    dynamic_parent=full_name,
                    dynamic_when=[str(opt_key)],
                )

    expanded_inputs = []
    for inp in getattr(schema, "inputs", ()) or ():
        expanded_inputs.extend(expand_input(inp) or ())

    for inp, name, dynamic_parent, dynamic_when in expanded_inputs:
        if not name:
            continue
        io_type = getattr(inp, "get_io_type", lambda: None)()
        io_type = io_type.upper() if isinstance(io_type, str) else io_type
        options: dict = {}
        if io_type == "COMBO":
            values = getattr(inp, "options", None)
            if isinstance(values, (list, tuple)):
                options["values"] = list(values)
            widget_type = "COMBO"
        elif io_type == "COMFY_DYNAMICCOMBO_V3":
            values = [getattr(option, "key", None) for option in getattr(inp, "options", ())]
            options["values"] = [value for value in values if value is not None]
            branches: dict[str, list[str]] = {}
            for option in getattr(inp, "options", ()) or ():
                opt_key = getattr(option, "key", None)
                if opt_key is None:
                    continue
                kids: list[str] = []
                for child in getattr(option, "inputs", ()) or ():
                    cid = getattr(child, "id", None)
                    if cid:
                        kids.append(f"{name}.{cid}")
                branches[str(opt_key)] = kids
            if branches:
                options["dynamic_branches"] = branches
            widget_type = "COMBO"
        elif io_type in _WIDGET_TYPES:
            widget_type = io_type
            for key in ("min", "max", "step", "round", "multiline", "placeholder"):
                value = getattr(inp, key, None)
                if value is not None:
                    options[key] = value
        else:
            continue
        if getattr(inp, "advanced", None):
            options["advanced"] = True
        if dynamic_parent:
            options["dynamic_parent"] = dynamic_parent
        if dynamic_when:
            options["dynamic_when"] = list(dynamic_when)
        out.append({"name": str(name), "type": widget_type, "options": options})

    # Dynamic schemas can expose the same child input in several branches.
    # Keep one stable row while preserving every enum value declared by those
    # branches. Prefer non-advanced when any branch exposes the input as primary.
    merged: dict[str, dict] = {}
    for item in out:
        previous = merged.get(item["name"])
        if previous is None:
            merged[item["name"]] = item
            continue
        if previous["type"] != item["type"]:
            # V3 schema metadata is appended after legacy metadata and is
            # authoritative when the two describe the same input differently.
            merged[item["name"]] = item
            continue
        old_values = previous["options"].get("values")
        new_values = item["options"].get("values")
        if isinstance(old_values, list) and isinstance(new_values, list):
            previous["options"]["values"] = list(dict.fromkeys(old_values + new_values))
        new_advanced = bool(item["options"].get("advanced"))
        old_advanced = bool(previous["options"].get("advanced"))
        for key, value in item["options"].items():
            if key in ("advanced", "dynamic_when", "dynamic_branches"):
                continue
            if key in ("min", "max") and key in previous["options"] and isinstance(value, (int, float)):
                cur = previous["options"][key]
                if isinstance(cur, (int, float)):
                    previous["options"][key] = min(cur, value) if key == "min" else max(cur, value)
                    continue
            previous["options"].setdefault(key, value)
        old_when = previous["options"].get("dynamic_when") or []
        new_when = item["options"].get("dynamic_when") or []
        if old_when or new_when:
            previous["options"]["dynamic_when"] = list(dict.fromkeys([*old_when, *new_when]))
        old_branches = previous["options"].get("dynamic_branches")
        new_branches = item["options"].get("dynamic_branches")
        if isinstance(old_branches, dict) and isinstance(new_branches, dict):
            merged_branches = dict(old_branches)
            for bk, bv in new_branches.items():
                merged_branches[bk] = list(dict.fromkeys((merged_branches.get(bk) or []) + list(bv or [])))
            previous["options"]["dynamic_branches"] = merged_branches
        elif new_branches and not old_branches:
            previous["options"]["dynamic_branches"] = new_branches
        if old_advanced and new_advanced:
            previous["options"]["advanced"] = True
        else:
            previous["options"].pop("advanced", None)
    return list(merged.values())


def _fallback_widget_meta(api_inputs: dict) -> list[dict]:
    """Infer editable widget metadata when a node has no legacy INPUT_TYPES()."""
    out: list[dict] = []
    hidden = {
        "force_run_token", "project_id", "parent_output_id", "unique_id",
        "custom_params", "captured_image",
    }
    for name, value in api_inputs.items():
        if name in hidden or (isinstance(value, list) and len(value) == 2):
            continue
        if isinstance(value, bool):
            type_ = "BOOLEAN"
        elif isinstance(value, int) and not isinstance(value, bool):
            type_ = "INT"
        elif isinstance(value, float):
            type_ = "FLOAT"
        else:
            type_ = "STRING"
        out.append({"name": str(name), "type": type_, "options": {}})
    return out


def _exposed_widgets(workflow_id: int, file_path: str,
                    bindings: list[db.WorkflowInputBinding],
                    api_json: Optional[dict]) -> list[dict]:

    if api_json is None or not isinstance(api_json, dict):
        return []

    if not file_path or not os.path.exists(file_path):
        return []
    try:
        with open(file_path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(doc, dict) or not isinstance(doc.get("nodes"), list):
        return []

    bindings_by_key: dict[tuple[str, str], db.WorkflowInputBinding] = {}
    for b in bindings:
        bindings_by_key[(str(b.node_id), str(b.input_name))] = b

    groups = []
    for g in doc.get("groups") or []:
        if isinstance(g, dict) and isinstance(g.get("bounding"), list):
            groups.append({"title": g.get("title"), "bounding": g["bounding"]})

    def group_for_pos(pos):
        if not pos or len(pos) < 2:
            return None
        x, y = pos[0], pos[1]
        for g in groups:
            b = g["bounding"]
            if len(b) != 4:
                continue
            gx, gy, gw, gh = b
            if gx <= x <= gx + gw and gy <= y <= gy + gh:
                return g["title"]
        return None

    subgraph_defs: dict[str, dict] = {}
    for sub in (doc.get("definitions") or {}).get("subgraphs") or []:
        sid = sub.get("id")
        if sid:
            subgraph_defs[str(sid)] = sub

    def iter_nodes_with_ids():
        deferred_subgraphs: list[tuple[str, dict, str]] = []
        for top in doc["nodes"]:
            if not isinstance(top, dict):
                continue
            top_id = str(top.get("id")) if top.get("id") is not None else ""
            top_type = top.get("type") or ""
            if top_type in subgraph_defs:
                sdef = subgraph_defs[top_type]
                sg_title = (
                    sdef.get("name")
                    or top.get("title")
                    or f"Subgraph #{top_id}"
                )
                deferred_subgraphs.append((top_id, sdef, sg_title))
                continue
            yield top_id, top, group_for_pos(top.get("pos"))

        for top_id, sdef, sg_title in deferred_subgraphs:
            for inner in (sdef.get("nodes") or []):
                if not isinstance(inner, dict):
                    continue
                inner_id = str(inner.get("id")) if inner.get("id") is not None else ""
                composite = f"{top_id}:{inner_id}"
                yield composite, inner, sg_title

    referenced_outputs = {
        (str(v[0]), v[1])
        for api_node in api_json.values() if isinstance(api_node, dict)
        for v in (api_node.get("inputs") or {}).values()
        if isinstance(v, list) and len(v) == 2
    }

    out: list[dict] = []
    for node_id, n, group_title in iter_nodes_with_ids():
        class_type = n.get("type") or ""
        if class_type in ("Note", "MarkdownNote", "Reroute", "PrimitiveNode"):
            continue

        api_node = api_json.get(node_id)
        if not isinstance(api_node, dict):
            continue
        api_inputs = api_node.get("inputs") or {}

        title = n.get("title") or class_type

        def row(name: str, type_: str, props: dict, current: Any) -> dict:
            binding = bindings_by_key.get((node_id, name))
            return {
                "node_id":      node_id,
                "node_title":   title,
                "node_type":    class_type,
                "group_title":  group_title,
                "widget_name":  name,
                "widget_type":  type_,
                "widget_props": props,
                "current_value": current,
                "stage_binding": binding.from_ if binding else None,
                "override_value": binding.default_value if binding else None,
                "cast":           binding.cast_ if binding else None,
                "required":       bool(binding.required) if binding else False,
            }

        widget_meta = _node_widget_meta(class_type)
        known_names: set[str] = set()
        api_top_keys = set(api_inputs)
        for wm in widget_meta:
            wname = wm["name"]
            known_names.add(wname)
            binding = bindings_by_key.get((node_id, wname))
            in_api = wname in api_inputs
            parent = wname.split(".", 1)[0] if "." in wname else None
            # Include inactive DynamicCombo branch children (not in current API
            # snapshot) when the parent combo is present or the field is bound.
            if not in_api:
                if binding is None and not (parent and parent in api_top_keys):
                    continue
                current = None
            else:
                current = api_inputs[wname]
                if isinstance(current, list) and len(current) == 2:
                    continue
            out.append(row(wname, wm["type"], wm.get("options") or {}, current))

        # New-schema and third-party nodes may not implement INPUT_TYPES().
        # Keep their scalar API inputs visible instead of exposing only fields
        # that already have a saved binding.
        for wm in _fallback_widget_meta({
            name: value for name, value in api_inputs.items()
            if name not in known_names
        }):
            out.append(row(wm["name"], wm["type"], wm.get("options") or {}, api_inputs[wm["name"]]))

        for slot, otype, oname in node_primitive_outputs(class_type):
            if (node_id, slot) in referenced_outputs:
                out.append(row(f"{OUTPUT_BINDING_PREFIX}{slot}", "OUTPUT",
                               {"output_type": otype, "output_name": oname}, None))
    return out


def node_primitive_outputs(class_type: str) -> list[tuple[int, str, str]]:
    import nodes
    cls = nodes.NODE_CLASS_MAPPINGS.get(class_type)
    if cls is None:
        return []
    types = getattr(cls, "RETURN_TYPES", ()) or ()
    names = getattr(cls, "RETURN_NAMES", None) or types
    out = []
    for slot, t in enumerate(types):
        t = t.value if hasattr(t, "value") else t
        if isinstance(t, str) and t in ("INT", "FLOAT", "STRING", "BOOLEAN"):
            out.append((slot, t, str(names[slot]) if slot < len(names) else t))
    return out


def _node_output_meta(class_type: str) -> tuple[Optional[bool], Optional[str]]:
    import nodes
    cls = (
        getattr(nodes, "NODE_CLASS_MAPPINGS", {}).get(class_type)
        if hasattr(nodes, "NODE_CLASS_MAPPINGS") else None
    )
    if cls is None:
        return None, None
    is_output = bool(getattr(cls, "OUTPUT_NODE", False))
    rt = getattr(cls, "RETURN_TYPES", ()) or ()
    out0: Optional[str] = None
    if isinstance(rt, (list, tuple)) and rt:
        first = rt[0]
        val = first.value if hasattr(first, "value") else first
        if isinstance(val, str):
            out0 = val
    return is_output, out0


def _node_input_type(node: dict) -> Optional[str]:
    for inp in node.get("inputs") or []:
        if isinstance(inp, dict) and inp.get("link") is not None and isinstance(inp.get("type"), str):
            return inp["type"]
    return None


def _extract_gui_view(file_path: str) -> dict:
    if not file_path or not os.path.exists(file_path):
        return {}
    try:
        with open(file_path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(doc, dict) or not isinstance(doc.get("nodes"), list):
        return {}

    gui_nodes  = []
    gui_notes  = []
    for n in doc["nodes"]:
        if not isinstance(n, dict):
            continue
        nid  = n.get("id")
        ntype = n.get("type") or ""
        if ntype in ("Note", "MarkdownNote"):
            wv = n.get("widgets_values") or []
            text = wv[0] if wv and isinstance(wv[0], str) else ""
            gui_notes.append({
                "type": ntype,
                "pos":  n.get("pos"),
                "text": text,
            })
            continue
        is_output, out_type = _node_output_meta(ntype)
        gui_nodes.append({
            "id":        str(nid) if nid is not None else "",
            "type":      ntype,
            "title":     n.get("title"),
            "pos":       n.get("pos"),
            "color":     n.get("color"),
            "bgcolor":   n.get("bgcolor"),
            "mode":      n.get("mode", 0),
            "is_output": is_output,
            "out_type":  out_type,
            "in_type":   _node_input_type(n),
        })

    gui_groups = []
    for g in doc.get("groups") or []:
        if not isinstance(g, dict):
            continue
        gui_groups.append({
            "title":     g.get("title"),
            "bounding":  g.get("bounding"),
            "color":     g.get("color"),
            "font_size": g.get("font_size"),
        })

    return {
        "gui_nodes":  gui_nodes,
        "gui_groups": gui_groups,
        "gui_notes":  gui_notes,
    }


def get_workflow_config(kind: str, label: str) -> Optional[dict]:
    db.init()
    with db.get_session() as s:
        row = s.execute(
            select(db.Workflow).where(db.Workflow.kind == kind, db.Workflow.label == label)
        ).scalar_one_or_none()
        if row is None:
            return None
        bindings = s.execute(
            select(db.WorkflowInputBinding)
            .where(db.WorkflowInputBinding.workflow_id == row.id)
            .order_by(db.WorkflowInputBinding.node_id, db.WorkflowInputBinding.input_name)
        ).scalars().all()

        api_obj = None
        if row.api_json:
            try:
                api_obj = json.loads(row.api_json)
            except json.JSONDecodeError:
                api_obj = None
        gui_view = _extract_gui_view(row.file_path)

        exposed = _exposed_widgets(row.id, row.file_path, list(bindings), api_obj)
        return {
            "id":          row.id,
            "kind":        row.kind,
            "label":       row.label,
            "file_path":   row.file_path,
            "file_mtime":  row.file_mtime,
            "link_type":   getattr(row, "link_type", db.LINK_TYPE_MANAGED) or db.LINK_TYPE_MANAGED,
            "file_exists": os.path.exists(row.file_path),
            "has_api":     bool(row.api_json),
            "api_json":    api_obj,
            "exposed_widgets": exposed,
            "gui_nodes":   gui_view.get("gui_nodes",  []),
            "gui_groups":  gui_view.get("gui_groups", []),
            "gui_notes":   gui_view.get("gui_notes",  []),
            "order":       row.order_,
            "description": row.description,
            "result_type": row.result_type,
            "result_node": row.result_node,
            "sizing":      json.loads(row.sizing_json) if row.sizing_json else {},
            "prune_when_missing":
                json.loads(row.prune_when_missing_json)
                if row.prune_when_missing_json else [],
            "meta":        json.loads(row.meta_json) if row.meta_json else {},
            "bindings": [
                {
                    "node_id":    b.node_id,
                    "input_name": b.input_name,
                    "from":       b.from_,
                    "default":    b.default_value,
                    "prefix":     b.prefix,
                    "suffix":     b.suffix,
                    "required":   bool(b.required),
                    "error_msg":  b.error_msg,
                    "cast":       b.cast_,
                }
                for b in bindings
            ],
        }
