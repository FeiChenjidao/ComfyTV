**English** | [简体中文](README.zh.md)

# `cutout/` workflows

Workflows in this folder appear in the **Cutout** dropdown. Wire an upstream image in and get the same image back with the subject segmented and the background replaced by a transparent alpha channel.

## Stage inputs

- **Source image** (required) — from upstream. No prompt, no tunable widgets.

## What your workflow needs

- A `SaveImage` output node (auto-detected).
- A `LoadImage` for the source image.
- A background-removal node. Online Bria returns an alpha-bearing `IMAGE` directly; segmenter chains can instead use `JoinImageWithAlpha`.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **Online Bria Cutout** (`birefnet-cutout.json` + `_preset.json`) — default. `LoadImage → BriaRemoveImageBackground → SaveImage`; no local model, but consumes Comfy API credits.

## Local models

None. The former BiRefNet and Qwen Image 2.1 cutout workflows have been replaced by online Bria.
