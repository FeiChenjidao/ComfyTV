from comfy_api.latest import io
from PIL import Image, ImageOps

from ..runners._media_paths import fresh_output_path, path_to_view_url, view_url_to_path
from .stages.common.emit import _stage_emit_auto
from .stages.common.inputs import _force_run_token, _parent_output_id_input, _project_id_input
from .stages.common.schema import COMFYTV_IMAGE


class AlphaMerge(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.AlphaMerge",
            display_name="Alpha Merge",
            category="ComfyTV/Image",
            search_aliases=["alpha image", "merge alpha", "RGBA", "Alpha 合并"],
            description="Copies the embedded alpha channel of the texture onto the base image.",
            inputs=[
                _force_run_token(),
                _project_id_input(),
                _parent_output_id_input(),
                COMFYTV_IMAGE.Input("image"),
                COMFYTV_IMAGE.Input("alpha_image", tooltip="A texture containing its own alpha channel, such as a transparent PNG."),
            ],
            outputs=[COMFYTV_IMAGE.Output("image", display_name="RGBA")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image: str, alpha_image: str, force_run_token=0,
                project_id="", parent_output_id=0) -> io.NodeOutput:
        image_path = view_url_to_path(image)
        if image_path is None:
            raise ValueError("Alpha Merge: connect a ComfyTV image for the base image.")
        alpha_path = view_url_to_path(alpha_image)
        if alpha_path is None:
            raise ValueError("Alpha Merge: connect a ComfyTV image for the alpha texture.")

        with Image.open(alpha_path) as source:
            texture = ImageOps.exif_transpose(source)
            if "A" in texture.getbands():
                alpha = texture.getchannel("A")
            elif "transparency" in texture.info:
                alpha = texture.convert("RGBA").getchannel("A")
            else:
                raise ValueError("Alpha Merge: the alpha texture has no alpha channel. Use a PNG with transparency.")

        with Image.open(image_path) as source:
            output = ImageOps.exif_transpose(source).convert("RGBA")
        if alpha.size != output.size:
            alpha = alpha.resize(output.size, Image.Resampling.BILINEAR)
        output.putalpha(alpha)
        path = fresh_output_path(".png", "comfytv/alpha-merge")
        output.save(path)
        return _stage_emit_auto(cls, project_id=project_id, payload_str=path_to_view_url(path),
                                parent_output_id=parent_output_id)
