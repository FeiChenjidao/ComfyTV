from comfy_api.latest import Types, io

_FILE3D_TYPES = [
    io.File3DGLB,
    io.File3DGLTF,
    io.File3DOBJ,
    io.File3DFBX,
    io.File3DSTL,
    io.File3DUSDZ,
    io.File3DPLY,
    io.File3DSPLAT,
    io.File3DSPZ,
    io.File3DKSPLAT,
    io.File3DSplatAny,
    io.File3DPointCloudAny,
    io.File3DAny,
]


class File3DFirst(io.ComfyNode):
    """Return the first non-empty File3D input.

    Used by Tripo (and similar) graphs that emit both GLB and FBX, with only one
    slot populated depending on ``quad``.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="File3DFirst",
            display_name="File3D First",
            category="ComfyTV/3d",
            description="Pass through the first connected, non-empty 3D file (model_a, then model_b).",
            inputs=[
                io.MultiType.Input(
                    "model_a",
                    types=_FILE3D_TYPES,
                    optional=True,
                    tooltip="Preferred 3D file (e.g. Tripo GLB).",
                ),
                io.MultiType.Input(
                    "model_b",
                    types=_FILE3D_TYPES,
                    optional=True,
                    tooltip="Fallback 3D file (e.g. Tripo FBX when quad is enabled).",
                ),
            ],
            outputs=[io.File3DAny.Output(display_name="model_3d")],
        )

    @classmethod
    def execute(cls, model_a: Types.File3D | None = None, model_b: Types.File3D | None = None) -> io.NodeOutput:
        for model in (model_a, model_b):
            if model is not None:
                return io.NodeOutput(model)
        raise ValueError("File3DFirst: both model_a and model_b are empty.")
