**English** | [简体中文](README.zh.md)

# `inpaint/` workflows

Workflows in this folder appear in the **Inpaint** dropdown. The user paints a mask on the source image; the workflow regenerates the masked region per the prompt.

## Stage inputs

- **Source image** (required) — from upstream.
- **Mask** (required) — painted by the user with the painter widget.
- **Prompt** — what the masked region should become.
- **Random seed**.

## What your workflow needs

- A `SaveImage` output node (auto-detected).
- A `LoadImage` for the source image, plus the mask via **either** of:
  - a separate `LoadImageMask` node (`channel = "alpha"`) — bind it to **Stage mask (painter output)**; or
  - the `LoadImage`'s own **MASK output** (the common pattern when masks are drawn in ComfyUI's mask editor) — bind the `LoadImage`'s `image` input to **Upstream image + painted mask (alpha)**. At run time ComfyTV bakes the painted mask into the image's alpha channel, so the single `LoadImage` outputs both.
- A `CLIPTextEncode` for the prompt.
- The model's inpaint conditioning (Flux Fill uses `InpaintModelConditioning`, SD1.5 uses `VAEEncodeForInpaint`).
- A `KSampler` with `denoise=1.0` to fully regenerate the masked region.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **GPT局部重绘** (`GPT局部重绘.json` + `_preset.json`) — masked editing with `OpenAIGPTImageNodeV2`.
- **Nanobanana 局部重绘** (`Nanobanana 局部重绘.json` + `_preset.json`) — masked editing with `GeminiNanoBanana2V2`.

Both workflows use ComfyUI API nodes and require the corresponding model access through a signed-in Comfy account.
