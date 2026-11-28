import torch
import torch.nn.functional as F

import comfy.utils
from comfy_api.latest import io


class AlphaMerge(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.AlphaMerge",
            display_name="Alpha Merge",
            category="ComfyTV/Image",
            search_aliases=["alpha image", "merge alpha", "RGBA", "Alpha 合并"],
            description="Uses the brightness of an alpha image as opacity and outputs an RGBA image.",
            inputs=[
                io.Image.Input("image"),
                io.Image.Input("alpha_image", tooltip="Black is transparent, white is opaque, and gray is semi-transparent."),
            ],
            outputs=[io.Image.Output(display_name="RGBA")],
        )

    @classmethod
    def execute(cls, image: torch.Tensor, alpha_image: torch.Tensor) -> io.NodeOutput:
        rgb = image[..., :3]
        if rgb.shape[-1] == 1:
            rgb = rgb.expand(-1, -1, -1, 3)

        alpha_image = alpha_image.to(image)
        if alpha_image.shape[-1] == 1:
            alpha = alpha_image[..., 0]
        else:
            weights = alpha_image.new_tensor([0.299, 0.587, 0.114])
            alpha = (alpha_image[..., :3] * weights).sum(dim=-1)

        if alpha.shape[1:] != rgb.shape[1:3]:
            alpha = F.interpolate(
                alpha.unsqueeze(1), size=rgb.shape[1:3], mode="bilinear", align_corners=False,
            ).squeeze(1)

        batch_size = max(len(rgb), len(alpha))
        rgb = comfy.utils.repeat_to_batch_size(rgb, batch_size)
        alpha = comfy.utils.repeat_to_batch_size(alpha, batch_size)
        return io.NodeOutput(torch.cat((rgb, alpha.clamp(0, 1).unsqueeze(-1)), dim=-1))
