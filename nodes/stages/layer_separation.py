from ._common import (
    COMFYTV_IMAGE,
    COMFYTV_IMAGES,
    StageEmptyOutput,
    _custom_params_input,
    _main_prompt_input,
    _stage_emit,
    _standard_stage_inputs,
    invoke_runner,
    io,
    labels_for,
)
from .common.compositor_ui import compositor_layer_group, compositor_ui_from_payload


_LAST_RUN: dict[str, tuple[tuple[int, str, str, str, str], str]] = {}


def _node_uid(cls) -> str:
    uid = getattr(getattr(cls, 'hidden', None), 'unique_id', None)
    return str(uid) if uid is not None else ''


class LayerSeparationStage(io.ComfyNode):
    """Run a workflow and expose its compositor layers as an image group."""

    @classmethod
    def define_schema(cls):
        workflows = labels_for('layer-separation') or []
        inputs = [
            *_standard_stage_inputs(),
            io.Combo.Input(
                "workflow",
                options=workflows,
                default=workflows[0] if workflows else "",
                tooltip="Layer-separation workflow that outputs ImageCompositor layers.",
            ),
            _main_prompt_input(
                placeholder="Describe what to separate (e.g. 'product on white, soft shadows').",
                tooltip="Subject / scene description for the separation workflow.",
            ),
            COMFYTV_IMAGE.Input("image", optional=True),
        ]
        compositor = getattr(io, 'Compositor', None)
        if compositor is not None:
            inputs.append(compositor.Input(
                "compositor",
                tooltip="Layer preview state used by the official compositor.",
            ))
        inputs.append(_custom_params_input())

        return io.Schema(
            node_id="ComfyTV.LayerSeparationStage",
            display_name="Layer Separation",
            category="ComfyTV/Image",
            inputs=inputs,
            outputs=[
                COMFYTV_IMAGES.Output(
                    "layers",
                    tooltip="Separated layers as an image group.",
                ),
            ],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    async def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                      workflow="", main_prompt="", image="", compositor=None,
                      custom_params="{}"):
        uid = _node_uid(cls)
        run_key = (
            int(force_run_token or 0),
            str(workflow or ''),
            str(main_prompt or '').strip(),
            str(image or ''),
            str(custom_params or '{}'),
        )
        cached = _LAST_RUN.get(uid) if uid else None
        if cached is not None and cached[0] == run_key:
            payload = cached[1]
        else:
            payload = await invoke_runner(
                custom_params=custom_params,
                kind='layer-separation',
                label=workflow,
                main_prompt=(main_prompt or '').strip(),
                upstream={'images': [image] if image else []},
                options={},
            )
            if uid:
                _LAST_RUN[uid] = (run_key, payload)

        layer_group = compositor_layer_group(payload)
        if not layer_group:
            raise StageEmptyOutput(
                "layer-separation workflow returned no ImageCompositor layers"
            )
        return _stage_emit(
            cls,
            project_id=project_id,
            output_type='images',
            payload_str=layer_group,
            parent_output_id=parent_output_id,
            extra_ui=compositor_ui_from_payload(layer_group),
            params={'workflow': workflow},
        )
