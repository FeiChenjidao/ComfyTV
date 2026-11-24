from ._common import *  # noqa: F401, F403
from ...runners.tripo_retopology import retopologize_model


class ModelRetopologyStage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.ModelRetopologyStage",
            display_name="3D Retopology (Tripo)",
            category="ComfyTV/3D",
            description="Import a generated model into Tripo and rebuild its topology. "
                        "Uses the paid Tripo API through your Comfy.org account. "
                        "Triangles produce GLB; quads produce FBX.",
            inputs=[
                *_standard_stage_inputs(),
                COMFYTV_MODEL.Input("model"),
                io.Int.Input("face_limit", default=-1, min=-1, max=20000, step=1,
                             tooltip="-1: automatic. 500–20,000 triangles or 500–10,000 quads."),
                io.Boolean.Input("quad", default=False, tooltip="Output a quad mesh as FBX."),
                io.Boolean.Input("bake", default=True, tooltip="Bake source textures onto the new mesh."),
            ],
            outputs=[COMFYTV_MODEL.Output("model")],
            is_api_node=True,
            is_output_node=True,
            hidden=[io.Hidden.unique_id, io.Hidden.auth_token_comfy_org, io.Hidden.api_key_comfy_org],
        )

    @classmethod
    async def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                      model="", face_limit=-1, quad=False, bake=True):
        _emit_progress(cls, 0, 2, text="Tripo: import and retopology")
        payload = await retopologize_model(
            model, face_limit=face_limit, quad=quad, bake=bake, hidden=cls.hidden,
        )
        _emit_progress(cls, 2, 2, text="done")
        return _stage_emit_auto(cls, project_id=project_id, payload_str=payload,
                                parent_output_id=parent_output_id)
