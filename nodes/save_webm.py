import json
import os
from fractions import Fraction

import folder_paths
from comfy_api.latest import io


_CODEC_NAMES = {
    "vp8": "libvpx",
    "vp9": "libvpx-vp9",
    "av1": "libsvtav1",
}


def _codec_settings(codec: str, has_alpha: bool) -> tuple[str, str, bool]:
    codec = str(codec or "").lower()
    if codec not in _CODEC_NAMES:
        raise ValueError(f"unsupported WebM codec: {codec!r}")
    save_alpha = has_alpha and codec == "vp9"
    pixel_format = "yuva420p" if save_alpha else (
        "yuv420p10le" if codec == "av1" else "yuv420p"
    )
    return _CODEC_NAMES[codec], pixel_format, save_alpha


def _encode_webm_file(images, output_path: str, codec: str, fps: float, crf: float,
                      metadata: dict | None = None) -> None:
    import av
    import torch

    codec = str(codec or "").lower()
    encoder_name, pixel_format, save_alpha = _codec_settings(
        codec, images.shape[-1] == 4,
    )
    container = av.open(output_path, mode="w")
    try:
        for key, value in (metadata or {}).items():
            container.metadata[str(key)] = json.dumps(value)

        stream = container.add_stream(
            encoder_name,
            rate=Fraction(round(float(fps) * 1000), 1000),
        )
        stream.width = int(images.shape[-2])
        stream.height = int(images.shape[-3])
        stream.pix_fmt = pixel_format
        stream.bit_rate = 0
        stream.options = {"crf": str(float(crf))}
        if codec == "av1":
            stream.options["preset"] = "6"

        channels = 4 if save_alpha else 3
        frame_format = "rgba" if save_alpha else "rgb24"
        for image in images:
            array = (
                torch.clamp(image[..., :channels] * 255, min=0, max=255)
                .to(device=torch.device("cpu"), dtype=torch.uint8)
                .numpy()
            )
            frame = av.VideoFrame.from_ndarray(array, format=frame_format)
            for packet in stream.encode(frame):
                container.mux(packet)
        container.mux(stream.encode())
    finally:
        container.close()


def _hidden_metadata(cls) -> dict:
    hidden = getattr(cls, "hidden", None)
    metadata = {}
    prompt = getattr(hidden, "prompt", None)
    if prompt is not None:
        metadata["prompt"] = prompt
    extra_pnginfo = getattr(hidden, "extra_pnginfo", None)
    if isinstance(extra_pnginfo, dict):
        metadata.update(extra_pnginfo)
    return metadata


class SaveWebM(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        hidden = [
            value for value in (
                getattr(io.Hidden, "prompt", None),
                getattr(io.Hidden, "extra_pnginfo", None),
            )
            if value is not None
        ]
        return io.Schema(
            node_id="ComfyTV.SaveWebM",
            search_aliases=["save webm", "export webm", "vp8", "vp9"],
            display_name="Save WebM (ComfyTV)",
            category="ComfyTV/Output",
            inputs=[
                io.Image.Input(
                    "images",
                    tooltip="Image frames to encode. RGBA transparency is preserved only with VP9.",
                ),
                io.String.Input("filename_prefix", default="ComfyTV/video"),
                io.Combo.Input(
                    "codec",
                    options=["vp8", "vp9", "av1"],
                    default="vp8",
                    tooltip="VP8 is broadly compatible. VP9 supports transparency. AV1 is smaller but slower.",
                ),
                io.Float.Input(
                    "fps", default=24.0, min=0.01, max=1000.0, step=0.01,
                ),
                io.Float.Input(
                    "crf", default=32.0, min=0.0, max=63.0, step=1.0,
                    tooltip="Lower values improve quality and increase file size.",
                ),
            ],
            hidden=hidden,
            is_output_node=True,
            outputs=[io.Image.Output(display_name="images")],
        )

    @classmethod
    def execute(cls, images, codec="vp8", fps=24.0,
                filename_prefix="ComfyTV/video", crf=32.0) -> io.NodeOutput:
        if images is None or len(images) == 0:
            raise RuntimeError("SaveWebM: no image frames provided")

        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                filename_prefix,
                folder_paths.get_output_directory(),
                int(images[0].shape[1]),
                int(images[0].shape[0]),
            )
        )
        file = f"{filename}_{counter:05}_.webm"
        output_path = os.path.join(full_output_folder, file)
        _encode_webm_file(
            images,
            output_path,
            str(codec),
            float(fps),
            float(crf),
            _hidden_metadata(cls),
        )

        from comfy_api.latest import ui
        preview = ui.PreviewVideo([
            ui.SavedResult(file, subfolder, io.FolderType.output),
        ])
        return io.NodeOutput(images, ui=preview)
