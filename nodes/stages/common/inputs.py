from comfy_api.latest import io

from .schema import (
    COMFYTV_TEXT, COMFYTV_IMAGE, COMFYTV_VIDEO, COMFYTV_MODEL, COMFYTV_MATERIAL,
    COMFYTV_FXSPEC, COMFYTV_AUDIO,
)


def _force_run_token() -> 'io.Int.Input':
    return io.Int.Input(
        "force_run_token",
        default=0, min=0, max=2_147_483_647, step=1,
        socketless=True,
        extra_dict={"hidden": True},
        tooltip="Internal — bumped on Run to invalidate ComfyUI's input cache.",
    )


def _project_id_input() -> 'io.String.Input':
    return io.String.Input(
        "project_id",
        default="",
        socketless=True,
        extra_dict={"hidden": True},
        tooltip="Internal — populated by the projectStore on the frontend.",
    )


def _parent_output_id_input() -> 'io.Int.Input':
    return io.Int.Input(
        "parent_output_id",
        default=0, min=0, max=2_147_483_647,
        socketless=True,
        extra_dict={"hidden": True},
        tooltip="Internal — lineage parent set by spawn handlers on the frontend.",
    )


def _custom_params_input() -> 'io.String.Input':
    return io.String.Input(
        "custom_params",
        default="{}",
        socketless=True,
        extra_dict={"hidden": True},
        tooltip="Internal — JSON of user-defined parameter attachments/values for this node.",
    )


def _selected_index_input() -> 'io.Int.Input':
    return io.Int.Input(
        "selected_index",
        default=1, min=1, max=999, step=1,
        socketless=True,
        extra_dict={"hidden": True},
        tooltip="Internal — 1-indexed cell pick for image-batch stages. Driven by clicking a thumbnail in the node's output grid.",
    )


def _main_prompt_input(*, tooltip: str = "", placeholder: str = "") -> 'io.String.Input':
    extra: dict = {"hidden": True}
    if placeholder:
        extra["placeholder"] = placeholder
    return io.String.Input(
        "main_prompt",
        default="", multiline=True,
        socketless=True,
        extra_dict=extra,
        tooltip=tooltip or None,
    )


def _text_template(max_n: int = 8) -> 'io.Autogrow.TemplatePrefix':
    return io.Autogrow.TemplatePrefix(
        COMFYTV_TEXT.Input("text", optional=True),
        prefix="text",
        min=0,
        max=max_n,
    )


def _image_template(max_n: int = 12) -> 'io.Autogrow.TemplatePrefix':
    return io.Autogrow.TemplatePrefix(
        COMFYTV_IMAGE.Input("image", optional=True),
        prefix="image",
        min=0,
        max=max_n,
    )


# Turnaround / multi-view faces for 3D Model Stage (and Custom Split wiring).
# 辅 = optional 5th ref for Rodin Gen-2.5 (accepts up to 5 images).
FACE_IMAGE_NAMES = ["正", "左", "背", "右", "辅"]


def _face_image_template() -> 'io.Autogrow.TemplateNames':
    return io.Autogrow.TemplateNames(
        COMFYTV_IMAGE.Input("image", optional=True),
        names=list(FACE_IMAGE_NAMES),
        # Keep the four turnaround slots always present; 辅 may stay empty.
        min=4,
    )


def _video_template(max_n: int = 6) -> 'io.Autogrow.TemplatePrefix':
    return io.Autogrow.TemplatePrefix(
        COMFYTV_VIDEO.Input("video", optional=True),
        prefix="video",
        min=0,
        max=max_n,
    )


def _audio_template(max_n: int = 3) -> 'io.Autogrow.TemplatePrefix':
    return io.Autogrow.TemplatePrefix(
        COMFYTV_AUDIO.Input("audio", optional=True),
        prefix="audio",
        min=0,
        max=max_n,
    )


def _model_template(max_n: int = 4) -> 'io.Autogrow.TemplatePrefix':
    return io.Autogrow.TemplatePrefix(
        COMFYTV_MODEL.Input("model", optional=True),
        prefix="model",
        min=0,
        max=max_n,
    )


def _material_template(max_n: int = 4) -> 'io.Autogrow.TemplatePrefix':
    return io.Autogrow.TemplatePrefix(
        COMFYTV_MATERIAL.Input("material", optional=True),
        prefix="material",
        min=0,
        max=max_n,
    )

