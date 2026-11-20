**English** | [简体中文](README.zh.md)

# `upscale/` workflows

Workflows in this folder appear in the **Upscale** dropdown. Wire an upstream image; get a higher-resolution version.

## Stage inputs

- **Source image** (required) — from upstream.
- **Scale** (`2x` / `4x`) — online workflows map it to their target resolution or scale factor.
- **Prompt** (optional) — consumed by creative upscale workflows.

## What your workflow needs

- A `SaveImage` output node (auto-detected).
- A `LoadImage` for the source image.
- An online upscale node, or a custom local upscaler chain.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **WaveSpeed (budget upscale)** — default online upscaler.
- **Magnific Upscale (Precise V2)** and **Magnific Upscale (Creative)** — online precise and creative variants.

The Ultrasharp workflow and its `4x-UltraSharp.pth` dependency have been removed.
