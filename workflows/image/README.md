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

- **NanoBanana2** (`NanoBanana2.json` + `_preset.json`) — Gemini NanoBanana 2 API image generation / edit (`GeminiNanoBanana2V2`). Up to 3 upstream reference images; aspect ratio from the stage. Requires a configured Gemini / NanoBanana API credential in ComfyUI.
- **GPT Image 2.5** (`GPT_Image_2.5.json` + `_preset.json`) — OpenAI GPT Image 2.5 API (`OpenAIGPTImageNodeV2`). Up to 3 upstream reference images; size / background / quality knobs from the preset. Requires a configured OpenAI API credential in ComfyUI.

## Models referenced

Both shipped workflows are **API-backed** — no local diffusion checkpoint download. Configure the matching API keys in ComfyUI / the node settings before Run.
