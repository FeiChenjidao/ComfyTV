from pathlib import Path

import folder_paths
from comfy_api.latest import io

from ..runners.media import localize
from ..runners.vp9_to_vp8 import vp9_to_vp8
from .stages.common.fx_helpers import _progress_cb
from .stages.common.schema import COMFYTV_VIDEO


def _preview_video(view_url: str):
    from comfy_api.latest import ui

    path = localize(view_url)
    output = Path(folder_paths.get_output_directory()).resolve()
    relative = path.resolve().relative_to(output)
    return ui.PreviewVideo([
        ui.SavedResult(
            relative.name,
            '/'.join(relative.parts[:-1]),
            io.FolderType.output,
        ),
    ])


class VP9ToVP8(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.VP9ToVP8",
            display_name="VP9 to VP8 Alpha",
            search_aliases=["vp9 to vp8", "convert vp9", "vp8 alpha"],
            category="ComfyTV/Video",
            inputs=[
                COMFYTV_VIDEO.Input(
                    "video",
                    tooltip="VP9 WebM input. Transparency is preserved.",
                ),
                io.Combo.Input(
                    "quality",
                    options=["draft", "standard", "high"],
                    default="high",
                    tooltip="Higher quality increases VP8 file size.",
                ),
            ],
            outputs=[COMFYTV_VIDEO.Output("video")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, video="", quality="high"):
        if not (video or '').strip():
            raise RuntimeError("VP9 to VP8 needs an upstream VP9 video.")
        output = vp9_to_vp8(
            video,
            quality=quality,
            progress=_progress_cb(cls),
        )
        return io.NodeOutput(output, ui=_preview_video(output))
