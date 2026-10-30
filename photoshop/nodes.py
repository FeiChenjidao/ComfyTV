import hashlib
import json
import os
from io import BytesIO

import aiohttp
import folder_paths
import numpy as np
import torch
from comfy_api.latest import io
from nodes import SaveImage
from PIL import Image, ImageOps

from .backend import PS_INPUTS


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


def _reference_tensor(index):
    name = f"PS_ref_{index}.png"
    path = os.path.join(PS_INPUTS, name)
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        return torch.zeros((1, 8, 8, 3), dtype=torch.float32)
    return _to_tensor(_open_image(name))


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
                io.Mask.Output(display_name="Mask"),
                io.Int.Output(display_name="Seed"),
                io.String.Output(display_name="+"),
                io.String.Output(display_name="-"),
                io.Int.Output(display_name="W"),
                io.Int.Output(display_name="H"),
                io.Image.Output(display_name="Ref1"),
                io.Image.Output(display_name="Ref2"),
                io.Image.Output(display_name="Ref3"),
                io.Image.Output(display_name="Ref4"),
                io.Image.Output(display_name="Ref5"),
                io.Image.Output(display_name="Ref6"),
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

        mask_image = ImageOps.exif_transpose(_open_image("PS_mask.png"))
        mask = np.array(mask_image.getchannel("B")).astype(np.float32) / 255.0
        mask[mask == (1 / 255.0)] = 0.0
        mask = torch.from_numpy(mask)

        def text(key, fallback=""):
            value = config.get(key, fallback)
            return fallback if value is None or value == "" else str(value)

        return io.NodeOutput(
            canvas,
            mask.unsqueeze(0),
            int(config["seed"]),
            config["positive"],
            config["negative"],
            int(width),
            int(height),
            *[_reference_tensor(index) for index in range(1, 7)],
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
            url = f"http://127.0.0.1:8188/ps/renderdone?filename={filename}"
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    await response.text()
        except Exception as error:
            print(f"# PS: error on send2Ps: {error}")
        return io.NodeOutput()


PHOTOSHOP_NODES = [PhotoshopFromPanel, SendToPhotoshop]
