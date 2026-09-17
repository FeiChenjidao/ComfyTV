"""Stage-level batch loop driven by the ComfyTV.BatchLoop marker node."""

from __future__ import annotations

import copy
import json
import logging
import random
from typing import Any

_log = logging.getLogger(__name__)

BATCH_LOOP_CLASS = "ComfyTV.BatchLoop"
_MAX_ITERS = 8
_SEED_INPUT_NAMES = frozenset({"seed", "noise_seed", "sampler_seed"})


def workflow_has_batch_loop(api_json: dict | None) -> bool:
    if not isinstance(api_json, dict):
        return False
    for node in api_json.values():
        if isinstance(node, dict) and node.get("class_type") == BATCH_LOOP_CLASS:
            return True
    return False


def batch_loop_iterations(config: dict | None, options: dict | None) -> int:
    """Return N>1 only when the workflow contains BatchLoop; else 1."""
    if not workflow_has_batch_loop((config or {}).get("api_json")):
        return 1
    raw = (options or {}).get("batch_size", 1)
    try:
        n = int(raw if raw not in (None, "") else 1)
    except (TypeError, ValueError):
        n = 1
    return max(1, min(_MAX_ITERS, n))


def prepare_iteration(workflow: dict, config: dict, index: int) -> dict:
    """Deep-copy the prepared graph and vary seeds for loop pass ``index``."""
    wf = copy.deepcopy(workflow)
    _reseed_bound_seeds(wf, config, index)
    _bump_unbound_seeds(wf, config, index)
    _nudge_sampling_for_api_nodes(wf, index)
    _stamp_save_prefixes(wf, index)
    _log_bound_prompt_snapshot(wf, config, index)
    return wf


def _bound_prompt_sites(config: dict) -> list[tuple[str, str]]:
    sites: list[tuple[str, str]] = []
    for node_id, fields in ((config or {}).get("inputs") or {}).items():
        for input_name, spec in (fields or {}).items():
            src = str((spec or {}).get("from") or "")
            if src in ("main_prompt", "option:negative"):
                sites.append((str(node_id), str(input_name)))
    return sites


def _log_bound_prompt_snapshot(workflow: dict, config: dict, index: int) -> None:
    sites = _bound_prompt_sites(config)
    if not sites:
        if index == 0:
            _log.warning(
                "[ComfyTV] BatchLoop: no main_prompt binding in this workflow — "
                "every pass will use whatever text is already saved on the nodes. "
                "Bind Stage main_prompt to the generator's prompt input."
            )
        return
    for node_id, input_name in sites:
        node = workflow.get(node_id) or {}
        val = (node.get("inputs") or {}).get(input_name)
        preview = val if not isinstance(val, str) else (val if len(val) <= 120 else val[:117] + "...")
        _log.info(
            "[ComfyTV] BatchLoop iter %d: node %s input %s = %r",
            index + 1, node_id, input_name, preview,
        )


def _nudge_sampling_for_api_nodes(workflow: dict, index: int) -> None:
    """Nano Banana (and similar) accept ``seed`` in the schema but often omit it
    from the HTTP body — identical prompts would otherwise hit the same API
    payload every loop. Nudge temperature slightly so each pass differs.
    """
    if index <= 0:
        return
    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict) or "temperature" not in inputs:
            continue
        val = inputs.get("temperature")
        if isinstance(val, list):
            continue
        try:
            t = float(val)
        except (TypeError, ValueError):
            continue
        inputs["temperature"] = round(min(2.0, max(0.0, t + 0.01 * index)), 4)


def _bound_seed_sites(config: dict) -> set[tuple[str, str]]:
    sites: set[tuple[str, str]] = set()
    for node_id, fields in ((config or {}).get("inputs") or {}).items():
        for input_name, spec in (fields or {}).items():
            if str((spec or {}).get("from") or "") == "option:seed":
                sites.add((str(node_id), str(input_name)))
    return sites


def _reseed_bound_seeds(workflow: dict, config: dict, index: int) -> None:
    for node_id, input_name in _bound_seed_sites(config):
        node = workflow.get(node_id)
        if not isinstance(node, dict):
            continue
        inputs = node.setdefault("inputs", {})
        base = inputs.get(input_name)
        try:
            base_i = int(base)
        except (TypeError, ValueError):
            base_i = random.randint(0, 2**31 - 1)
        inputs[input_name] = (base_i + index) % (2**31)


def _bump_unbound_seeds(workflow: dict, config: dict, index: int) -> None:
    if index <= 0:
        return
    bound = _bound_seed_sites(config)
    for node_id, node in workflow.items():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for key, val in list(inputs.items()):
            if key not in _SEED_INPUT_NAMES:
                continue
            if (str(node_id), str(key)) in bound:
                continue
            if isinstance(val, list):
                continue
            try:
                inputs[key] = (int(val) + index) % (2**31)
            except (TypeError, ValueError):
                inputs[key] = random.randint(0, 2**31 - 1)


def _stamp_save_prefixes(workflow: dict, index: int) -> None:
    if index <= 0:
        return
    for node in workflow.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") not in (
            "SaveImage", "SaveAnimatedWEBP", "SaveAnimatedPNG", "PreviewImage",
        ):
            continue
        inputs = node.setdefault("inputs", {})
        prefix = str(inputs.get("filename_prefix") or "ComfyUI")
        inputs["filename_prefix"] = f"{prefix}_b{index + 1}"


def images_from_payload(payload: Any) -> list[dict]:
    if payload is None:
        return []
    if isinstance(payload, str):
        s = payload.strip()
        if not s:
            return []
        if s.startswith("/view?"):
            return [{"index": "1", "label": "#1", "image_url": s}]
        if s.startswith("{"):
            try:
                return images_from_payload(json.loads(s))
            except json.JSONDecodeError:
                return []
        return []
    if isinstance(payload, dict):
        imgs = payload.get("images")
        if isinstance(imgs, list):
            out = []
            for it in imgs:
                if not isinstance(it, dict):
                    continue
                url = it.get("image_url") or it.get("url")
                if not url:
                    continue
                out.append({
                    "index": str(it.get("index") or len(out) + 1),
                    "label": str(it.get("label") or f"#{len(out) + 1}"),
                    "image_url": url,
                })
            return out
    return []


def merge_loop_payloads(payloads: list[Any], result_meta: dict | None = None) -> str:
    """Merge N single-run payloads into one Stage image-batch JSON string."""
    if not payloads:
        raise RuntimeError("batch loop produced no results")
    if len(payloads) == 1:
        p0 = payloads[0]
        return p0 if isinstance(p0, str) else json.dumps(p0)

    rtype = (result_meta or {}).get("type")
    if rtype not in (None, "ui_save_batch", "ui_save_url", "ui_save_layered"):
        _log.warning(
            "[ComfyTV] BatchLoop x%d but result.type=%r — returning last run only",
            len(payloads), rtype,
        )
        last = payloads[-1]
        return last if isinstance(last, str) else json.dumps(last)

    images: list[dict] = []
    for p in payloads:
        images.extend(images_from_payload(p))
    if not images:
        last = payloads[-1]
        return last if isinstance(last, str) else json.dumps(last)

    for i, it in enumerate(images):
        it["index"] = str(i + 1)
        it["label"] = f"#{i + 1}"
    return json.dumps({"images": images})
