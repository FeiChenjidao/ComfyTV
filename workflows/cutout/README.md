**English** | [简体中文](README.zh.md)

# `cutout/` workflows

Workflows in this folder appear in the **Cutout** dropdown. Wire an upstream image in and get the same image back with the subject segmented and the background replaced by a transparent alpha channel.

## Stage inputs

- **Source image** (required) — from upstream. No prompt, no tunable widgets.

## What your workflow needs

- A `SaveImage` output node (auto-detected).
- A `LoadImage` for the source image.
- A background-removal node (BiRefNet, BriaRMBG, etc.) that emits both `IMAGE` (subject) and `MASK`.
- A `JoinImageWithAlpha` (or equivalent) that combines the subject + mask into a transparent-bg PNG. Some segmenter chains do this internally.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **BiRefNet Cutout** (`birefnet-cutout.json` + `_preset.json`) — Adapted from ComfyUI's `utility_birefnet_remove_background` template. Top-level: `LoadImage` → BiRefNet subgraph → `SaveImage`. The subgraph wraps `RemoveBackground` / `LoadBackgroundRemovalModel` / `InvertMask` / `JoinImageWithAlpha`.
- **Qwen Image 2.1 Cutout** (`qwen-image-2.1-cutout.json` + `_preset.json`) — generative alternative from the official `image_qwen_image_2_1_background_removal` template: `LoadImage` → `TextEncodeQwenImage21` with the fixed instruction *"Remove the background, and output a PNG image"* → `KSampler` → the 2.1 VAE decodes a real alpha channel, so `SaveImage` writes an RGBA PNG with no segmenter or `JoinImageWithAlpha`. Cleaner than BiRefNet on busy / graphic backgrounds (on a pop-art collage source BiRefNet kept a halftone fragment above the head and left green spill on the hair; 2.1 did neither), but the subject is re-synthesised rather than masked — fine detail can shift — and it takes ~10 s at 1K on a 5090 once the model is loaded (~45 s cold) vs ~7 s. It needs a distinct foreground subject: fed a landscape with none, it returned a fully transparent image. Keep BiRefNet for pixel-exact product cutouts. Tested working.

## Models referenced

- `birefnet.safetensors` → `models/background_removal/`, ~900 MB. Download: <https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors>
- Qwen Image 2.1 Cutout: `qwen_image_2.1_int8_convrot.safetensors` → `models/diffusion_models/`, `qwen3vl_8b_int8_convrot.safetensors` → `models/text_encoders/`, `qwen_image_2.1_vae_bf16.safetensors` → `models/vae/` (~17 GB, <https://huggingface.co/Comfy-Org/Qwen-Image-2.1>, ComfyUI v0.37+)
