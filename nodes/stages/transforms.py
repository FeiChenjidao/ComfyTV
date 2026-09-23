import json

from ._common import *

IMAGES_SPLIT_MAX = 32
IMAGE_MERGE_MAX = 32


def _image_group_urls(images: str) -> list[str]:
    s = (images or "").strip()
    if not s:
        return []
    try:
        parsed = json.loads(s)
    except Exception:
        return [s]
    items = parsed.get("images") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return []
    urls: list[str] = []
    for im in items:
        if isinstance(im, dict):
            u = str(im.get("image_url") or im.get("url") or "").strip()
        else:
            u = str(im or "").strip()
        if not u:
            continue
        urls.append(u)
        if len(urls) >= IMAGES_SPLIT_MAX:
            break
    return urls


class CropStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.CropStage",
            display_name="Crop",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.Int.Input("crop_x", default=0, min=0, max=8192,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_y", default=0, min=0, max=8192,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_w", default=0, min=0, max=8192,
                             socketless=True, extra_dict={"hidden": True}),
                io.Int.Input("crop_h", default=0, min=0, max=8192,
                             socketless=True, extra_dict={"hidden": True}),
                io.String.Input("crop_boxes", default="[]", multiline=False,
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="JSON array of crop rectangles "
                                        "[{id,x,y,w,h}, …]. Hidden — driven by the Vue panel."),
                COMFYTV_IMAGE.Input("image", optional=True),
                _selected_index_input(),
            ],
            outputs=[COMFYTV_IMAGES.Output("images"), COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                crop_x=0, crop_y=0, crop_w=0, crop_h=0, crop_boxes="[]",
                image="", selected_index=1):
        import json as _json
        return io.NodeOutput(_json.dumps({"images": [image] if image else []}), image)


class RotateStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.RotateStage",
            display_name="Rotate",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.Int.Input("angle", default=0, min=-180, max=180, step=1,
                             socketless=True, extra_dict={"hidden": True},
                             tooltip="Rotation angle in degrees (-180 to 180, positive = clockwise)."),
                COMFYTV_IMAGE.Input("image", optional=True),
            ],
            outputs=[COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                angle=0, image=""):
        return io.NodeOutput(image)


class ColorGradeStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.ColorGradeStage",
            display_name="Color Grade",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.String.Input("grade_state", default="", multiline=False,
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="JSON of the selected effect + slider values. "
                                        "Hidden — driven by the Vue panel."),
                COMFYTV_IMAGE.Input("image", optional=True),
            ],
            outputs=[COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                grade_state="", image=""):
        return io.NodeOutput(image)


class MirrorStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.MirrorStage",
            display_name="Mirror",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.Boolean.Input("flip_horizontal", default=False,
                                 socketless=True, extra_dict={"hidden": True},
                                 tooltip="Flip left↔right."),
                io.Boolean.Input("flip_vertical", default=False,
                                 socketless=True, extra_dict={"hidden": True},
                                 tooltip="Flip top↔bottom."),
                COMFYTV_IMAGE.Input("image", optional=True),
            ],
            outputs=[COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                flip_horizontal=False, flip_vertical=False, image=""):
        return io.NodeOutput(image)


class GridSplitStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.GridSplitStage",
            display_name="Grid Split",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.Int.Input("rows", default=2, min=1, max=10, step=1,
                             socketless=True, extra_dict={"hidden": True},
                             tooltip="Number of grid rows. Hidden — driven by the Vue panel."),
                io.Int.Input("cols", default=2, min=1, max=10, step=1,
                             socketless=True, extra_dict={"hidden": True},
                             tooltip="Number of grid columns. Hidden — driven by the Vue panel."),
                io.Int.Input("border", default=0, min=0, max=4096, step=1,
                             socketless=True, extra_dict={"hidden": True},
                             tooltip="Width (in source px) of the dividing border cut out between "
                                     "cells. 0 = plain split. Hidden — driven by the Vue panel."),
                io.Boolean.Input("outer_border", default=False,
                                 socketless=True, extra_dict={"hidden": True},
                                 tooltip="Whether the border is also cut from the outer edges of the "
                                         "image (a margin around the whole grid). Hidden — driven by "
                                         "the Vue panel."),
                COMFYTV_IMAGE.Input("image", optional=True),
                _selected_index_input(),
            ],

            outputs=[COMFYTV_IMAGES.Output("images"), COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                rows=2, cols=2, border=0, outer_border=False, image="", selected_index=1):
        import json as _json
        return io.NodeOutput(_json.dumps({"images": [image] if image else []}), image)


class CustomSplitStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.CustomSplitStage",
            display_name="Custom Split",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.String.Input("v_splits", default="[0.5]", multiline=False,
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="JSON array of vertical split fractions (0–1). "
                                        "Hidden — driven by the Vue panel."),
                io.String.Input("h_splits", default="[]", multiline=False,
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="JSON array of horizontal split fractions (0–1). "
                                        "Hidden — driven by the Vue panel."),
                io.String.Input("cell_labels", default="[]", multiline=False,
                                socketless=True, extra_dict={"hidden": True},
                                tooltip="JSON array of per-cell names (正/左/背/右). "
                                        "Hidden — driven by the Vue panel."),
                COMFYTV_IMAGE.Input("image", optional=True),
                _selected_index_input(),
            ],
            outputs=[COMFYTV_IMAGES.Output("images"), COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                v_splits="[0.5]", h_splits="[]", cell_labels="[]", image="", selected_index=1):
        import json as _json
        return io.NodeOutput(_json.dumps({"images": [image] if image else []}), image)


class CompareStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.CompareStage",
            display_name="Compare",
            category="ComfyTV/Compose",
            inputs=[
                _project_id_input(),
                COMFYTV_IMAGE.Input("image_a", optional=True),
                COMFYTV_IMAGE.Input("image_b", optional=True),
            ],
            outputs=[],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, project_id="", image_a="", image_b=""):
        return io.NodeOutput()


class ImagesSplitStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.ImagesSplitStage",
            display_name="Split Images",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.MultiType.Input(
                    "images", [COMFYTV_IMAGES, COMFYTV_IMAGE], optional=True,
                    tooltip="Image group to split into one COMFYTV_IMAGE socket per item.",
                ),
            ],
            outputs=[
                COMFYTV_IMAGE.Output(f"image{i}")
                for i in range(1, IMAGES_SPLIT_MAX + 1)
            ],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0, images=""):
        urls = _image_group_urls(images)
        padded = urls + [""] * (IMAGES_SPLIT_MAX - len(urls))
        return io.NodeOutput(*padded[:IMAGES_SPLIT_MAX])


class ImageMergeStage(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyTV.ImageMergeStage",
            display_name="Merge Images",
            category="ComfyTV/Image",
            inputs=[
                *_standard_stage_inputs(),
                io.Combo.Input(
                    "merge_mode", options=["layers", "row"], default="layers",
                    socketless=True, extra_dict={"hidden": True},
                    tooltip="layers = stack like Photoshop (source-over at 0,0); "
                            "row = place images left to right.",
                ),
                io.Combo.Input(
                    "aspect_ratio", options=["native", "1:1"], default="native",
                    socketless=True, extra_dict={"hidden": True},
                    tooltip="native = keep source aspect; 1:1 = square output "
                            "(layers: pad composite to long side; row: pad each "
                            "image to a shared long-side square then tile).",
                ),
                # Autogrow keeps the socket strip short (min+1). Load-time restore
                # in the frontend re-expands and reattaches saved wires.
                io.Autogrow.Input(
                    "images",
                    template=io.Autogrow.TemplatePrefix(
                        COMFYTV_IMAGE.Input("image", optional=True),
                        prefix="image",
                        min=1,
                        max=IMAGE_MERGE_MAX,
                    ),
                ),
            ],
            outputs=[COMFYTV_IMAGE.Output("image")],
            is_output_node=True,
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, force_run_token=0, project_id="", parent_output_id=0,
                merge_mode="layers", aspect_ratio="native", images=None, **kwargs):
        vals = [v for v in _autogrow_values(images) if v]
        if not vals:
            for i in range(IMAGE_MERGE_MAX):
                v = kwargs.get(f"image{i}")
                if v:
                    vals.append(v)
        return io.NodeOutput(vals[0] if vals else "")
