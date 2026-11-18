**English** | [简体中文](README.zh.md)

# `image/` workflows

Workflows in this folder appear in the **Image Stage** dropdown. Take a prompt + 0..N reference images, produce one or more images.

## Stage inputs

- **Prompt** + optional **negative prompt**.
- **Reference image** (optional) — i2i / multi-ref workflows use upstream images.
- **Resolution** (`1K` / `2K` / `4K`), **aspect ratio** (`1:1`, `16:9`, etc.), **batch size** (1..8), **random seed**.

## What your workflow needs

- A `SaveImage` output node (auto-detected; multiple outputs are merged into a `COMFYTV_IMAGES` batch).
- Nodes that consume the stage prompt / images / size / seed as bound by the preset.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **NanoBanana2** (`NanoBanana2.json` + `_preset.json`) — Gemini Nano Banana 2.1 API image generation / edit (`GeminiNanoBanana2V2`). Up to 3 upstream reference images; aspect ratio from the stage. Requires a configured Gemini / NanoBanana API credential in ComfyUI.
- **GPT Image 2.6** (`GPT_Image_2.6.json` + `_preset.json`) — OpenAI GPT Image 2.6 API (`OpenAIGPTImageNodeV3`). Up to 3 upstream reference images; size, background, quality, complexity, and batch controls come from the preset. Requires a configured OpenAI API credential in ComfyUI.
- **Seedream 5.5** (`Seedream_5.5.json` + `_preset.json`) — ByteDance Seedream API generation / editing (`ByteDanceSeedreamNodeV3`). Up to 3 reference images; the Image Stage exposes the official model, size preset, custom dimensions, background, and seed controls while retaining ComfyTV's generation count.

`PS_NanoBanana_GPTImage` remains shipped for the Photoshop bridge, but its `is_hidden` preset keeps it out of the regular Image Stage picker.

## Models referenced

All three shipped workflows are **API-backed** — no local diffusion checkpoint download. Configure the matching API keys in ComfyUI / the node settings before Run.
