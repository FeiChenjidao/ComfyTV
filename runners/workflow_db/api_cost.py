"""Estimate ComfyUI API-node credit cost for a bound stage workflow.

Scans the workflow's ``api_json`` for nodes flagged ``api_node`` in the host
``object_info`` / ``GET_NODE_INFO_V1`` schema, and returns enough data for the
frontend to evaluate each node's ``price_badge`` JSONata expression (same rules
as ComfyUI's node pricing badges).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

_log = logging.getLogger(__name__)

_api_defs_cache: Optional[dict[str, dict]] = None


def _is_link(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 2
        and isinstance(value[0], (str, int))
        and isinstance(value[1], int)
    )


def invalidate_api_node_defs() -> None:
    global _api_defs_cache
    _api_defs_cache = None


def _schema_to_api_def(name: str, schema: dict) -> Optional[dict]:
    if not isinstance(schema, dict):
        return None
    is_api = bool(schema.get("api_node"))
    if not is_api:
        return None
    return {
        "class_type": name,
        "display_name": schema.get("display_name") or name,
        "price_badge": schema.get("price_badge"),
    }


def get_api_node_defs() -> dict[str, dict]:
    """Return ``{class_type: {display_name, price_badge}}`` for paid API nodes."""
    global _api_defs_cache
    if _api_defs_cache is not None:
        return _api_defs_cache

    out: dict[str, dict] = {}
    try:
        from .convert import build_object_info
        info = build_object_info()
    except Exception as e:
        _log.warning("[ComfyTV/api_cost] build_object_info failed: %s", e)
        _api_defs_cache = out
        return out

    for name, schema in (info or {}).items():
        if not isinstance(name, str):
            continue
        entry = _schema_to_api_def(name, schema if isinstance(schema, dict) else {})
        if entry is None:
            # V1 fallback: some nodes expose API_NODE via class attr but
            # GET_NODE_INFO_V1 may omit it when schema build fails partially.
            continue
        out[name] = entry

    # Also pick up V1 classes that only set API_NODE on the class.
    try:
        import nodes
        mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {}) or {}
        for name, cls in mappings.items():
            if name in out:
                continue
            try:
                flag = getattr(cls, "API_NODE", False)
            except Exception:
                flag = False
            if not flag:
                continue
            price_badge = None
            display = name
            getter = getattr(cls, "GET_NODE_INFO_V1", None)
            if callable(getter):
                try:
                    full = getter()
                    if isinstance(full, dict):
                        price_badge = full.get("price_badge")
                        display = full.get("display_name") or display
                except Exception:
                    pass
            out[name] = {
                "class_type": name,
                "display_name": display,
                "price_badge": price_badge,
            }
    except Exception as e:
        _log.debug("[ComfyTV/api_cost] NODE_CLASS_MAPPINGS scan skipped: %s", e)

    _api_defs_cache = out
    return out


def _node_io(node: dict) -> tuple[dict[str, Any], dict[str, bool], dict[str, int]]:
    """Split api-format inputs into widgets / connection flags / group counts."""
    widgets: dict[str, Any] = {}
    connected: dict[str, bool] = {}
    group_hits: dict[str, int] = {}
    raw = node.get("inputs")
    if not isinstance(raw, dict):
        return widgets, connected, group_hits

    for name, value in raw.items():
        if not isinstance(name, str):
            continue
        if _is_link(value):
            connected[name] = True
            if "." in name:
                group = name.split(".", 1)[0]
                group_hits[group] = group_hits.get(group, 0) + 1
        else:
            connected[name] = False
            widgets[name] = value
    return widgets, connected, group_hits


def collect_api_cost_nodes(api_json: Optional[dict]) -> list[dict]:
    """List paid API nodes present in an API-format prompt."""
    if not isinstance(api_json, dict) or not api_json:
        return []

    defs = get_api_node_defs()
    if not defs:
        return []

    out: list[dict] = []
    for node_id, node in api_json.items():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        if not isinstance(class_type, str):
            continue
        info = defs.get(class_type)
        if info is None:
            continue
        widgets, connected, group_hits = _node_io(node)
        meta = node.get("_meta") if isinstance(node.get("_meta"), dict) else {}
        title = meta.get("title") if isinstance(meta.get("title"), str) else None
        out.append({
            "id": str(node_id),
            "class_type": class_type,
            "title": title or info.get("display_name") or class_type,
            "price_badge": info.get("price_badge"),
            "widgets": widgets,
            "inputs": {k: {"connected": bool(v)} for k, v in connected.items()},
            "input_groups": group_hits,
        })
    return out


def get_workflow_api_cost(kind: str, label: str) -> Optional[dict]:
    from .config import get_workflow_config

    cfg = get_workflow_config(kind, label)
    if cfg is None:
        return None
    nodes = collect_api_cost_nodes(cfg.get("api_json"))
    return {
        "kind": kind,
        "label": label,
        "has_api": bool(cfg.get("has_api")),
        "nodes": nodes,
        "bindings": cfg.get("bindings") or [],
    }
