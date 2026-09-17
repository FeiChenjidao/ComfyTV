from ._common import *


class LayerSeparationStage(io.ComfyNode):
    """Run a layer-separation workflow, then browse the result in a PSD compositor."""

    @classmethod
    def define_schema(cls):
        workflows = labels_for('layer-separation') or []
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
                            "PSD/PSB (result type: Layered image).",
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
                    tooltip="Selected layer id(s). Hidden — Vue panel.",
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
                      psd_file="", selected_id="", captured_image="", captured_images="",
                      custom_params="{}"):
        payload = await invoke_runner(
            custom_params=custom_params,
            kind='layer-separation',
            label=workflow,
            main_prompt=(main_prompt or '').strip(),
            upstream={'images': [image] if image else []},
            options={},
        )
        # Primary socket carries the layered PSD URL; frontend loads the compositor.
        # Second socket keeps any prior layer-batch capture until the panel re-composites.
        return _stage_emit_auto(
            cls,
            project_id=project_id,
            payload_str=payload,
            parent_output_id=parent_output_id,
            extra_outputs=[captured_images or ""],
            params={'workflow': workflow, 'psd_file': payload},
        )
