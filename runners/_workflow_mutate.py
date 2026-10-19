import logging
import re
from datetime import datetime

from .base import RunnerContext
from ._workflow_resolve import (
    _MEDIA_KINDS,
    _UPSTREAM_BUCKET_BY_KIND,
    _UPSTREAM_PAT,
    _Resolver,
    KEEP_ORIGINAL,
    OUTPUT_BINDING_PREFIX,
)

_log = logging.getLogger(__name__)


def _split_runner_id(runner_id: str) -> tuple[str, str]:
    if "/" not in runner_id:
        raise RuntimeError(
            f"runner id {runner_id!r} must be 'kind/name' (e.g. 'image/local-sd15')"
        )
    kind, base = runner_id.split("/", 1)
    return kind, base


_BATCH_OUTPUT_KINDS = {
    'image',
    'shot-images',
    'split-part',
}


_TEXT_OUTPUT_NODES = (
    "SaveText",
    "SaveText|pysssss",
    "ShowText|pysssss",
    "ShowText",
    "PreviewAny",
    "Display Any (rgthree)",
    "DisplayAny",
)


def _auto_detect_result(workflow: dict, ctx_kind: str | None = None) -> dict:
    if ctx_kind == 'layer-separation':
        for node_id, node in workflow.items():
            if isinstance(node, dict) and node.get("class_type") == "ImageCompositor":
                return {"type": "ui_save_url", "node": node_id}
        image_default = 'ui_save_layered'
    elif ctx_kind in _BATCH_OUTPUT_KINDS:
        image_default = 'ui_save_batch'
    else:
        image_default = 'ui_save_url'
    save_node_result = {
        'SaveImage':         image_default,
        'SaveImageAdvanced': image_default,
        'SaveAnimatedWEBP':  image_default,
        'SaveAnimatedPNG':   image_default,
        'PreviewImage':      image_default,
        'SaveVideo':         'ui_save_url',
        'SaveAudio':         'ui_save_url',
        'SaveAudioMP3':      'ui_save_url',
        'SaveAudioOpus':     'ui_save_url',
        'SaveAudioAdvanced': 'ui_save_url',
        'VHS_VideoCombine':  'ui_save_url',
        'SaveGLB':           'ui_save_url',
    }
    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type")
        if isinstance(ct, str) and ct in save_node_result:
            return {"type": save_node_result[ct], "node": node_id}

    for wanted in _TEXT_OUTPUT_NODES:
        for node_id, node in workflow.items():
            if isinstance(node, dict) and node.get("class_type") == wanted:
                return {"type": "graph_output_first", "node": node_id}

    raise RuntimeError(
        "Couldn't auto-detect this workflow's result node: it has no save-class "
        "node (SaveImage / SaveVideo / SaveAudio…) and no text-output node "
        "(PreviewAny / ShowText / SaveText). Select the stage on the canvas, "
        "open the ComfyTV sidebar, and pick a node under 'Result' to tell "
        "ComfyTV which node produces this stage's output."
    )


def _gc_unreachable(workflow: dict, config: dict) -> set[str]:
    import nodes as comfy_nodes
    hinted = str((config.get("result") or {}).get("node") or "")
    stack = []
    for nid, node in workflow.items():
        if not isinstance(node, dict):
            continue
        cls = comfy_nodes.NODE_CLASS_MAPPINGS.get(node.get("class_type"))
        if nid == hinted or (cls is not None and getattr(cls, "OUTPUT_NODE", False)):
            stack.append(nid)
    if not stack:
        return set()
    keep: set[str] = set()
    while stack:
        nid = stack.pop()
        if nid in keep:
            continue
        keep.add(nid)
        for v in (workflow.get(nid, {}).get("inputs") or {}).values():
            if isinstance(v, list) and len(v) == 2 and str(v[0]) in workflow:
                stack.append(str(v[0]))
    dead = set(workflow) - keep
    for nid in dead:
        workflow.pop(nid, None)
    return dead


_COUNT_PAT = re.compile(
    r"^upstream_(image|video|audio|text|model):count_(lt|le|gt|ge|eq)\[(\d+)\]$"
)
_ANY_PAT = re.compile(
    r"^upstream_(image|video|audio|text|model):any\[([\d,]+)\]$"
)
_NONE_PAT = re.compile(
    r"^upstream_(image|video|audio|text|model):none\[([\d,]+)\]$"
)


def _parse_index_list(raw: str) -> list[int]:
    return [int(x) for x in raw.split(",") if x.strip() != ""]


def _upstream_slot_filled(upstream, idx: int) -> bool:
    if isinstance(upstream, str):
        upstream = [upstream]
    return idx < len(upstream) and upstream[idx] not in (None, "")


def _scrub_dangling_links(workflow: dict) -> None:
    """Drop input links that point at nodes already removed from the prompt."""
    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for key, val in list(inputs.items()):
            if isinstance(val, list) and len(val) == 2 and str(val[0]) not in workflow:
                inputs.pop(key, None)


def _upstream_nonempty(ctx: RunnerContext, kind: str) -> list:
    upstream = ctx.upstream.get(_UPSTREAM_BUCKET_BY_KIND[kind]) or []
    if isinstance(upstream, str):
        upstream = [upstream]
    return [u for u in upstream if u not in (None, "")]


def _prune_rule_matches(when: str, ctx: RunnerContext, mode: str) -> bool | None:
    """Return True if the rule should fire, False if not, None if ``when`` is invalid."""
    m_count = _COUNT_PAT.match(when)
    if m_count:
        kind, op, n_str = m_count.group(1), m_count.group(2), m_count.group(3)
        n = int(n_str)
        count = len(_upstream_nonempty(ctx, kind))
        ok = {
            "lt": count < n,
            "le": count <= n,
            "gt": count > n,
            "ge": count >= n,
            "eq": count == n,
        }[op]
        # count_* rules ignore ``if`` — the comparison already encodes the condition
        return ok

    m_any = _ANY_PAT.match(when)
    if m_any:
        kind, idxs = m_any.group(1), _parse_index_list(m_any.group(2))
        upstream = ctx.upstream.get(_UPSTREAM_BUCKET_BY_KIND[kind]) or []
        # any[...] ignores ``if`` — presence of any listed slot is the condition
        return any(_upstream_slot_filled(upstream, i) for i in idxs)

    m_none = _NONE_PAT.match(when)
    if m_none:
        kind, idxs = m_none.group(1), _parse_index_list(m_none.group(2))
        upstream = ctx.upstream.get(_UPSTREAM_BUCKET_BY_KIND[kind]) or []
        # none[...] ignores ``if`` — all listed slots empty is the condition
        return all(not _upstream_slot_filled(upstream, i) for i in idxs)

    m = _UPSTREAM_PAT.match(when)
    if not m:
        return None
    kind, _suffix, idx_str = m.group(1), m.group(2), m.group(3)
    idx = int(idx_str) if idx_str else 0
    upstream = ctx.upstream.get(_UPSTREAM_BUCKET_BY_KIND[kind]) or []
    have = _upstream_slot_filled(upstream, idx)
    if mode == "missing":
        return not have
    if mode == "present":
        return have
    return None


def _apply_prunes(workflow: dict, config: dict, ctx: RunnerContext) -> set[str]:
    """Apply ``prune_when_missing`` rules.

    Slot form: ``upstream_*:value[i]`` / ``annotated[i]`` …
      - default ``"if": "missing"`` — fire when that slot is empty
      - ``"if": "present"`` — fire when that slot is filled

    Count form (for single↔multi auto-switch):
      - ``upstream_image:count_lt[2]`` — fewer than 2 non-empty images
      - ``upstream_image:count_ge[2]`` — two or more images

    Side-slot form (Tripo/Meshy turnaround — ignore image4 extras):
      - ``upstream_image:none[1,2,3]`` — no left/back/right → single-image path
      - ``upstream_image:any[1,2,3]`` — at least one side → multiview path
    """
    pruned: set[str] = set()
    gc_needed = False
    rules = config.get("prune_when_missing") or []
    for rule in rules:
        when = str(rule.get("when") or "")
        mode = str(rule.get("if") or "missing").lower()
        if mode not in ("missing", "present"):
            _log.warning("prune_when_missing: bad `if` %r — skipped", mode)
            continue
        matched = _prune_rule_matches(when, ctx, mode)
        if matched is None:
            _log.warning("prune_when_missing: bad `when` %r — skipped", when)
            continue
        if not matched:
            continue
        dropped_here = False
        for nid in rule.get("drop_nodes") or []:
            sid = str(nid)
            if sid in workflow:
                workflow.pop(sid)
                pruned.add(sid)
                dropped_here = True
        for target in (rule.get("drop_inputs") or []) + (rule.get("drop_upstream_of") or []):
            node = workflow.get(str(target.get("node")))
            if node is None:
                continue
            node.get("inputs", {}).pop(target.get("input"), None)
            dropped_here = True
        if dropped_here or rule.get("drop_upstream_of") or rule.get("drop_nodes"):
            gc_needed = True
    if pruned:
        _scrub_dangling_links(workflow)
    if gc_needed:
        pruned |= _gc_unreachable(workflow, config)
        _scrub_dangling_links(workflow)
    return pruned


def _input_is_required(class_type: str | None, input_name: str) -> bool:
    import nodes as comfy_nodes
    cls = comfy_nodes.NODE_CLASS_MAPPINGS.get(class_type)
    if cls is None:
        return True
    try:
        spec = cls.INPUT_TYPES()
    except Exception:
        return True
    return input_name in (spec.get("required") or {})


def _cascade_drop_plan(workflow: dict, config: dict, root: str) -> set[str] | None:
    import nodes as comfy_nodes
    hinted = str((config.get("result") or {}).get("node") or "")
    dropped: set[str] = set()
    stack = [root]
    while stack:
        nid = stack.pop()
        if nid in dropped or nid not in workflow:
            continue
        node = workflow[nid]
        cls = comfy_nodes.NODE_CLASS_MAPPINGS.get(node.get("class_type"))
        if nid == hinted or (cls is not None and getattr(cls, "OUTPUT_NODE", False)):
            return None
        dropped.add(nid)
        for cid, cnode in workflow.items():
            if cid in dropped:
                continue
            for iname, v in (cnode.get("inputs") or {}).items():
                if (isinstance(v, list) and len(v) == 2 and str(v[0]) == nid
                        and _input_is_required(cnode.get("class_type"), iname)):
                    stack.append(cid)
                    break
    return dropped


def _auto_prune_unbound(workflow: dict, config: dict, ctx: RunnerContext) -> set[str]:
    roots: set[str] = set()
    for node_id, fields in (config.get("inputs") or {}).items():
        if str(node_id) not in workflow:
            continue
        for _input_name, spec in (fields or {}).items():
            m = _UPSTREAM_PAT.match(str(spec.get("from") or ""))
            if not m or m.group(1) not in _MEDIA_KINDS:
                continue
            kind, suffix, idx_str = m.group(1), m.group(2), m.group(3)
            if spec.get("required") or spec.get("default") is not None:
                continue
            if suffix == "masked" and not str(ctx.options.get("mask_data") or "").strip():
                roots.add(str(node_id))
                break
            idx = int(idx_str) if idx_str else 0
            upstream = ctx.upstream.get(_UPSTREAM_BUCKET_BY_KIND[kind]) or []
            if isinstance(upstream, str):
                upstream = [upstream]
            if idx < len(upstream) and upstream[idx] not in (None, ""):
                continue
            roots.add(str(node_id))
            break

    pruned: set[str] = set()
    for root in sorted(roots):
        plan = _cascade_drop_plan(workflow, config, root)
        if plan is None:
            _log.warning(
                "[ComfyTV] node %s has an unwired optional media binding but "
                "removing it would take an output node down — leaving it in "
                "place with its own widget values", root,
            )
            continue
        for nid in plan:
            workflow.pop(nid, None)
        pruned |= plan

    if not pruned:
        return pruned
    for cnode in workflow.values():
        inputs = cnode.get("inputs") or {}
        dangling = [k for k, v in inputs.items()
                    if isinstance(v, list) and len(v) == 2 and str(v[0]) in pruned]
        for k in dangling:
            inputs.pop(k)
    pruned |= _gc_unreachable(workflow, config)
    _log.info("[ComfyTV] auto-pruned %d node(s) fed by unwired optional "
              "bindings: %s", len(pruned), ", ".join(sorted(pruned)))
    return pruned


def _replace_output_refs(workflow: dict, node_id: str, slot: int, value) -> None:
    for cnode in workflow.values():
        inputs = cnode.get("inputs") or {}
        for k, v in inputs.items():
            if isinstance(v, list) and len(v) == 2 and str(v[0]) == node_id and v[1] == slot:
                inputs[k] = value


def _apply_overrides(workflow: dict, config: dict, resolver: _Resolver,
                     pruned_nodes: set[str] | None = None) -> None:
    pruned_nodes = pruned_nodes or set()
    overrides = config.get("inputs") or {}
    orphaned: list[str] = []
    for node_id, fields in overrides.items():
        node = workflow.get(node_id)
        if node is None:
            if node_id not in pruned_nodes:
                orphaned.append(str(node_id))
                _log.warning(
                    "[ComfyTV/local-comfy] skipping override for missing workflow "
                    "node %r — workflow was likely re-saved with different node ids; "
                    "re-map this input in the Workflow Config sidebar if still needed.",
                    node_id,
                )
            continue
        node_inputs = node.setdefault("inputs", {})
        for input_name, spec in (fields or {}).items():
            where = f"node {node_id} input {input_name!r}"
            value = resolver.resolve(where, spec)
            if value is KEEP_ORIGINAL:
                continue
            if input_name.startswith(OUTPUT_BINDING_PREFIX):
                _replace_output_refs(workflow, str(node_id),
                                     int(input_name[len(OUTPUT_BINDING_PREFIX):]), value)
            else:
                node_inputs[input_name] = value

    if orphaned:
        from .notify import notify_toast
        notify_toast(
            "warn",
            "Workflow input mapping skipped",
            f"{len(orphaned)} input mapping(s) point at nodes no longer in this "
            f"workflow ({', '.join(orphaned[:5])}). It ran with the workflow's own "
            f"defaults — re-map them in the Workflow Config sidebar.",
        )


def _output_node_ids(prompt: dict, hinted: str) -> list[str]:
    import nodes as comfy_nodes
    ids = [hinted]
    for nid, node in prompt.items():
        if nid == hinted:
            continue
        cls = comfy_nodes.NODE_CLASS_MAPPINGS.get(node.get("class_type"))
        if cls is not None and getattr(cls, "OUTPUT_NODE", False):
            ids.append(nid)
    return ids


_REPLACEMENT = re.compile(r"%([^%]+)%")
_DATE_TOKEN = re.compile(r"dd?|MM?|hh?|mm?|ss?|yyy?y?")
_UNSAFE_FILENAME = re.compile(r'[/?<>\\:*|"\x00-\x1F\x7F]')


def _format_date(fmt: str, now: datetime) -> str:
    parts = {"d": now.day, "M": now.month, "h": now.hour, "m": now.minute, "s": now.second}

    def token(m: re.Match) -> str:
        t = m.group(0)
        if t == "yy":
            return str(now.year)[2:]
        if t == "yyyy":
            return str(now.year)
        if t[0] in parts:
            return str(parts[t[0]]).zfill(len(t))
        return t

    return _DATE_TOKEN.sub(token, fmt)


def _widget_text(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _apply_text_replacements(workflow: dict, now: datetime) -> None:
    nodes = [n for n in workflow.values() if isinstance(n, dict)]

    def replace(m: re.Match) -> str:
        split = m.group(1).split(".")
        if len(split) != 2:
            return _format_date(split[0][5:], now) if split[0].startswith("date:") else m.group(0)
        name, widget = split
        matches = ([n for n in nodes if n.get("class_type") == name]
                   or [n for n in nodes if (n.get("_meta") or {}).get("title") == name])
        value = (matches[0].get("inputs") or {}).get(widget) if matches else None
        if value is None or isinstance(value, list):
            return m.group(0)
        return _UNSAFE_FILENAME.sub("_", _widget_text(value))

    for node in nodes:
        inputs = node.get("inputs") or {}
        prefix = inputs.get("filename_prefix")
        if isinstance(prefix, str) and "%" in prefix:
            inputs["filename_prefix"] = _REPLACEMENT.sub(replace, prefix)
