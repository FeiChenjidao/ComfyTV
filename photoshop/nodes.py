import base64
import hashlib
import json
import os
from io import BytesIO

import folder_paths
import numpy as np
import torch
from comfy_api.latest import io
from nodes import SaveImage
from PIL import Image, ImageOps

from .backend import PS_INPUTS, send_render_file, send_render_payload, thumb_png_bytes


def _file_hash(name):
    path = os.path.join(PS_INPUTS, name)
    try:
        with open(path, "rb") as file:
            return hashlib.md5(file.read()).hexdigest()
    except OSError:
        return "missing"


def _open_image(name):
    path = os.path.join(PS_INPUTS, name)
    try:
        with open(path, "rb") as file:
            data = file.read()
        image = Image.open(BytesIO(data))
        image.verify()
        return Image.open(BytesIO(data))
    except OSError:
        return Image.new(mode="RGB", size=(24, 24), color=(0, 0, 0))


def _to_tensor(image):
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    pixels = np.array(image)
    if pixels.ndim == 2:
        pixels = np.stack([pixels, pixels, pixels], axis=-1)
    return torch.from_numpy(pixels.astype(np.float32) / 255.0)[None,]


def _optional_image_tensor(name):
    path = os.path.join(PS_INPUTS, name)
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        return None
    return _to_tensor(_open_image(name).convert("RGB"))


def _fit_media_tensor(image, height, width):
    if image.shape[1] == height and image.shape[2] == width:
        return image
    source_height, source_width = image.shape[1:3]
    scale = min(width / source_width, height / source_height)
    target_width = max(1, min(width, round(source_width * scale)))
    target_height = max(1, min(height, round(source_height * scale)))
    resized = torch.nn.functional.interpolate(
        image.movedim(-1, 1),
        size=(target_height, target_width),
        mode="bilinear",
        align_corners=False,
    )
    left = (width - target_width) // 2
    right = width - target_width - left
    top = (height - target_height) // 2
    bottom = height - target_height - top
    if left or right or top or bottom:
        resized = torch.nn.functional.pad(resized, (left, right, top, bottom), mode="replicate")
    return resized.movedim(1, -1)


class PhotoshopFromPanel(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🔹Photoshop ComfyUI Plugin",
            display_name="Photoshop",
            category="Photoshop",
            description="Read the canvas, mask, and prompt sent by the ComfyTV Photoshop panel.",
            inputs=[],
            outputs=[
                io.Image.Output(display_name="Canvas"),
                io.Image.Output(display_name="Mask"),
                io.Image.Output(display_name="Ref1"),
                io.Image.Output(display_name="Ref2"),
                io.Image.Output(display_name="Ref3"),
                io.Image.Output(display_name="Ref4"),
                io.Image.Output(display_name="Ref5"),
                io.Image.Output(display_name="Ref6"),
                io.Image.Output(display_name="Media Batch"),
                io.Boolean.Output(display_name="Has Mask"),
                io.Int.Output(display_name="Seed"),
                io.String.Output(display_name="+"),
                io.String.Output(display_name="-"),
                io.Int.Output(display_name="W"),
                io.Int.Output(display_name="H"),
                io.Combo.Output(display_name="比例"),
                io.Combo.Output(display_name="质量"),
                io.Combo.Output(display_name="分辨率"),
                io.Combo.Output(display_name="输出背景"),
                io.Combo.Output(display_name="尺寸"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls):
        names = ["config.json", "PS_canvas.png", "PS_mask.png"]
        names.extend(f"PS_ref_{index}.png" for index in range(1, 7))
        return "|".join(_file_hash(name) for name in names)

    @classmethod
    def execute(cls):
        config_path = os.path.join(PS_INPUTS, "config.json")
        with open(config_path, "r", encoding="utf-8") as file:
            config = json.load(file)

        image = _open_image("PS_canvas.png")
        canvas = _to_tensor(image)
        width, height = image.size

        has_mask = bool(config.get("hasMask")) and os.path.isfile(os.path.join(PS_INPUTS, "PS_mask.png"))
        mask_image = ImageOps.exif_transpose(_open_image("PS_mask.png")) if has_mask else Image.new("L", (width, height), 255)
        if mask_image.size != (width, height):
            mask_image = mask_image.resize((width, height), Image.Resampling.BILINEAR)
        canvas = _to_tensor(image.convert("RGB"))
        optional_mask = _to_tensor(mask_image.convert("RGB")) if has_mask else None
        reference_count = max(0, min(6, int(config.get("referenceCount") or 0)))
        references = [
            _optional_image_tensor(f"PS_ref_{index}.png") if index <= reference_count else None
            for index in range(1, 7)
        ]
        media = [canvas]
        if optional_mask is not None:
            media.append(optional_mask)
        media.extend(reference for reference in references if reference is not None)
        media_batch = torch.cat(
            [_fit_media_tensor(item, height, width) for item in media],
            dim=0,
        )

        def text(key, fallback=""):
            value = config.get(key, fallback)
            return fallback if value is None or value == "" else str(value)

        return io.NodeOutput(
            canvas,
            optional_mask,
            *references,
            media_batch,
            has_mask,
            int(config["seed"]),
            config["positive"],
            config["negative"],
            int(width),
            int(height),
            text("aspect", "auto"),
            text("quality"),
            text("resolution", "2K"),
            text("background", "auto"),
            text("size", "auto"),
        )


class SendToPhotoshop(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🔹SendTo Photoshop Plugin",
            display_name="送回 Photoshop",
            category="Photoshop",
            description="Save the image and send it back to the ComfyTV Photoshop panel.",
            inputs=[io.Image.Input("output")],
            is_output_node=True,
        )

    @classmethod
    async def execute(cls, output, prompt=None, extra_pnginfo=None):
        saver = SaveImage()
        saver.output_dir = folder_paths.get_temp_directory()
        saver.type = "temp"
        saver.prefix_append = "_temp_"
        saver.compress_level = 4
        saved = saver.save_images(output, "PS_OUTPUTS", prompt, extra_pnginfo)
        filename = saved["ui"]["images"][0]["filename"]
        try:
            job_id = ""
            try:
                with open(os.path.join(PS_INPUTS, "config.json"), "r", encoding="utf-8") as file:
                    job_id = str(json.load(file).get("jobId") or "")
            except (OSError, ValueError):
                pass
            await send_render_file(filename, job_id)
        except Exception as error:
            print(f"# PS: error on send2Ps: {error}")
        return io.NodeOutput()


def _tensor_image(value):
    tensor = value.detach().cpu()
    if tensor.ndim == 4:
        tensor = tensor[0]
    array = tensor.clamp(0, 1).numpy()
    if array.ndim == 2:
        array = np.stack([array, array, array], axis=-1)
    if array.shape[-1] == 1:
        array = np.repeat(array, 3, axis=-1)
    return (array[..., :3] * 255.0 + 0.5).astype(np.uint8)


def _tensor_mask(value, size):
    if value is None:
        return np.full((size[1], size[0]), 255, dtype=np.uint8)
    tensor = value.detach().cpu()
    if tensor.ndim == 3:
        tensor = tensor[0]
    mask = Image.fromarray((tensor.clamp(0, 1).numpy() * 255.0 + 0.5).astype(np.uint8), mode="L")
    if mask.size != size:
        mask = mask.resize(size, Image.Resampling.BILINEAR)
    return 255 - np.array(mask, dtype=np.uint8)


def _png_base64(image, mask=None):
    rgb = _tensor_image(image)
    pil = Image.fromarray(rgb, mode="RGB")
    if mask is not None:
        pil = pil.convert("RGBA")
        pil.putalpha(Image.fromarray(_tensor_mask(mask, pil.size), mode="L"))
    buffer = BytesIO()
    pil.save(buffer, format="PNG", compress_level=4)
    return base64.b64encode(buffer.getvalue()).decode("ascii"), buffer.getvalue(), pil.size


def _layered_payload(layer_stack):
    source = layer_stack if isinstance(layer_stack, dict) else {}
    canvas = source.get("canvas") or (0, 0)
    width = max(1, int(canvas[0] or 1))
    height = max(1, int(canvas[1] or 1))
    layers = []
    for index, item in enumerate(source.get("layers") or []):
        if not isinstance(item, dict) or item.get("image") is None:
            continue
        encoded, _, size = _png_base64(item["image"], item.get("mask"))
        layers.append({
            "name": str(item.get("name") or ("background" if index == 0 else f"layer {index}"))[:120],
            "base64": encoded,
            "x": int(round(float(item.get("x") or 0))),
            "y": int(round(float(item.get("y") or 0))),
            "width": int(size[0]),
            "height": int(size[1]),
            "zIndex": int(item.get("z_index") if item.get("z_index") is not None else index),
        })
    if not layers:
        raise ValueError("Seedream returned no Photoshop layers")
    layers.sort(key=lambda item: item["zIndex"])
    return {"canvas": {"width": width, "height": height}, "layers": layers}


class SendLayersToPhotoshop(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🔹SendLayersTo Photoshop Plugin",
            display_name="分层送回 Photoshop",
            category="Photoshop",
            description="Send a layered Seedream result back to Photoshop as editable layers.",
            inputs=[io.Layers.Input("layers"), io.Image.Input("preview")],
            is_output_node=True,
        )

    @classmethod
    async def execute(cls, layers, preview, prompt=None, extra_pnginfo=None):
        preview_base64, preview_bytes, _ = _png_base64(preview)
        job_id = ""
        try:
            with open(os.path.join(PS_INPUTS, "config.json"), "r", encoding="utf-8") as file:
                job_id = str(json.load(file).get("jobId") or "")
        except (OSError, ValueError):
            pass
        thumb = ""
        try:
            thumb = base64.b64encode(thumb_png_bytes(preview_bytes)).decode("ascii")
        except Exception:
            pass
        await send_render_payload(preview_base64, job_id, thumb, _layered_payload(layers))
        return io.NodeOutput()


PHOTOSHOP_NODES = [PhotoshopFromPanel, SendToPhotoshop, SendLayersToPhotoshop]
