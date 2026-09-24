import logging
import uuid

from .base import Runner, RunnerContext
from ._workflow_resolve import (  # noqa: F401
    _Resolver,
    _SHORT_SIDE_BY_TIER,
    _aspect_ratio_value,
    _cast,
    _composite_masked_image,
    _resolve_default,
    _resolve_length,
    _resolve_wh,
    _view_url_to_annotated,
)
from ._workflow_mutate import (  # noqa: F401
    _apply_overrides,
    _apply_prunes,
    _auto_detect_result,
    _auto_prune_unbound,
    _output_node_ids,
    _split_runner_id,
)
from ._nested_exec import (  # noqa: F401
    _extract_result,
    _filter_subprompt_preview,
    _run_subprompt,
    _save_files_from,
    _translate_subprompt_event,
    _view_url,
)
from ._batch_loop import (
    batch_loop_iterations,
    merge_loop_payloads,
    prepare_iteration,
)

_log = logging.getLogger(__name__)


def prepare_workflow(runner_id: str, kinds, ctx: RunnerContext) -> tuple[dict, dict, dict]:
    from . import workflow_db
    kind, label = _split_runner_id(runner_id)

    if ctx.kind not in kinds:
        raise NotImplementedError(
            f"{runner_id} doesn't handle kind={ctx.kind!r} "
            f"(declared: {sorted(kinds)})"
        )

    config = workflow_db.get_workflow_for_invoke(kind, label)
    if config is None:
        raise RuntimeError(
            f"workflow {kind!r}/{label!r} not in DB — startup seed missed it?"
        )

    import copy
    workflow = copy.deepcopy(config["api_json"])

    pruned_nodes = _apply_prunes(workflow, config, ctx)
    pruned_nodes |= _auto_prune_unbound(workflow, config, ctx)
    resolver = _Resolver(config, ctx)
    _apply_overrides(workflow, config, resolver, pruned_nodes)

    result_meta = _custom_multi_result(config) or config.get("result") or {}
    if not result_meta.get("node"):
        result_meta = _auto_detect_result(workflow, ctx.kind)
    result_node = result_meta.get("node")
    if not result_node:
        raise RuntimeError(
            f"{runner_id}: no result node — select the stage on the canvas, "
            f"open the ComfyTV sidebar, and pick a node under 'Result' "
            f"(or ship a `_preset.json` declaring `result`)."
        )
    return workflow, result_meta, config


def _custom_multi_result(config: dict) -> dict:
    from .custom_io import normalize_custom_io, result_meta_for
    custom_io = (config.get("meta") or {}).get("custom_io")
    if not custom_io:
        return {}
    return result_meta_for(normalize_custom_io(custom_io))


def _execute_node_ids(workflow: dict, result_meta: dict) -> list[str]:
    if result_meta.get("type") == "multi":
        ids = [str(o.get("node") or "") for o in result_meta.get("outputs") or []]
        return [nid for nid in ids if nid and nid in workflow]
    return _output_node_ids(workflow, result_meta.get("node"))


class LocalComfyUIRunner(Runner):

    async def invoke(self, ctx: RunnerContext):
        workflow, result_meta, config = prepare_workflow(self.id, self.kinds, ctx)
        n = batch_loop_iterations(config, ctx.options)

        if n <= 1:
            sub_prompt_id = f"comfytv-{uuid.uuid4().hex[:8]}"
            _log.info("[ComfyTV/%s] %s  nodes=%d", self.id, sub_prompt_id, len(workflow))
            execute_outputs = _execute_node_ids(workflow, result_meta)
            executor = await _run_subprompt(workflow, sub_prompt_id,
                                            execute_outputs=execute_outputs)
            return await _extract_result(executor, result_meta)

        _log.info("[ComfyTV/%s] BatchLoop x%d  stage_prompt=%r",
                  self.id, n, (ctx.main_prompt or "")[:80])
        payloads: list = []
        for i in range(n):
            # Re-prepare every pass so main_prompt / upstream bindings are
            # freshly written (never rely on a stale mutated graph).
            if i > 0:
                workflow, result_meta, config = prepare_workflow(
                    self.id, self.kinds, ctx)
            wf = prepare_iteration(workflow, config, i)
            execute_outputs = _execute_node_ids(wf, result_meta)
            sub_prompt_id = f"comfytv-{uuid.uuid4().hex[:8]}-b{i + 1}"
            _log.info("[ComfyTV/%s] %s  iter=%d/%d nodes=%d",
                      self.id, sub_prompt_id, i + 1, n, len(wf))
            executor = await _run_subprompt(wf, sub_prompt_id,
                                            execute_outputs=execute_outputs)
            payloads.append(await _extract_result(executor, result_meta))
            # Shared nested executor caches across invokes — clear so the next
            # pass cannot reuse identical API / sampler outputs.
            if hasattr(executor, "history_result"):
                executor.history_result = None
            executor.reset()
        return merge_loop_payloads(payloads, result_meta)
