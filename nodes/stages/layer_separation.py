from ._common import *
from .common.compositor_ui import (
    compositor_output_values,
    compositor_ui_from_payload,
)

_LAST_RUN: dict[str, tuple[tuple[int, str, str, str, str], str]] = {}


def _node_uid(cls) -> str:
    hidden = getattr(cls, 'hidden', None)
    uid = getattr(hidden, 'unique_id', None)
    return str(uid) if uid is not None else ''


class LayerSeparationStage(io.ComfyNode):
    """Run a layer-separation workflow, then preview/edit it as ImageCompositor."""

    @classmethod
    def define_schema(cls):
        workflows = labels_for('layer-separation') or []
        compositor = getattr(io, 'Compositor', None)
        compositor_inputs = []
        if compositor is not None:
            compositor_inputs.append(
                compositor.Input(
                    "compositor",
                    tooltip="Layered composition saved by the official compositor editor.",
                )
            )
        return io.Schema(
            node_id="ComfyTV.LayerSeparationStage",
            display_name="Layer Separation",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.Combo.Input(
                    "workflow",
                    options=workflows,
                    default=workflows[0] if workflows else "",
                    tooltip="Layer-separation workflow. Result should be a layered "
                            "PSD/PSB (result type: Layered image) or an image batch.",
                ),
                _main_prompt_input(
                    placeholder="Describe what to separate (e.g. 'product on white, soft shadows').",
                    tooltip="Subject / scene description for the separation workflow.",
                ),
                COMFYTV_IMAGE.Input("image", optional=True),
                io.String.Input(
                    "psd_file", default="",
                    socketless=True, extra_dict={"hidden": True},
                    tooltip="Layered PSD /view URL from the last run. Hidden — Vue panel.",
                ),
                io.String.Input(
                    "selected_id", default="",
                    socketless=True, extra_dict={"hidden": True},
                    tooltip="Legacy selected layer id(s). Hidden — unused by ImageCompositor.",
                ),
                io.String.Input(
                    "captured_image", default="",
                    socketless=True, extra_dict={"hidden": True},
                    tooltip="Last composite capture URL. Hidden — Vue panel.",
                ),
                io.String.Input(
                    "captured_images", default="",
                    socketless=True, extra_dict={"hidden": True},
                    tooltip="JSON images batch of selected layers. Hidden — Vue panel.",
                ),
                *compositor_inputs,
                _custom_params_input(),
            ],
            outputs=[
                COMFYTV_IMAGE.Output("image"),
                COMFYTV_IMAGES.Output("images"),
            ],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    async def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                      workflow="", main_prompt="", image="",
                      psd_file="", selected_id="",
                      captured_image="", captured_images="",
                      compositor=None,
                      custom_params="{}"):
        uid = _node_uid(cls)
        token = int(force_run_token or 0)
        run_key = (
            token,
            str(workflow or ''),
            str(main_prompt or '').strip(),
            str(image or ''),
            str(custom_params or '{}'),
        )
        cached = _LAST_RUN.get(uid) if uid else None
        # Compositor editor save re-queues this node without bumping force_run_token.
        if uid and cached is not None and cached[0] == run_key:
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
        extra_ui = compositor_ui_from_payload(payload)
        image_output, images_output = compositor_output_values(payload)
        emitted = _stage_emit_auto(
            cls,
            project_id=project_id,
            payload_str=payload,
            parent_output_id=parent_output_id,
            extra_outputs=[captured_images or images_output],
            extra_ui=extra_ui or None,
            params={'workflow': workflow, 'psd_file': payload},
        )
        return io.NodeOutput(
            captured_image or image_output,
            captured_images or images_output,
            ui=emitted.ui,
        )
