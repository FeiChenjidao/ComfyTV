**English** | [简体中文](README.zh.md)

# `erase/` workflows

Workflows in this folder appear in the **Erase** dropdown. The user paints over an object they want **removed**, clicks Run, and the object disappears — the painted region is filled from surrounding context with no prompt input. Distinct from **Inpaint**, where the user *describes what should appear* in the masked region.

The shipped workflow uses online GPT Image and no longer depends on LaMa or a third-party inpaint plugin.

## Stage inputs

- **Source image** (required) — from upstream.
- **Mask** (required) — painted by the user with the painter widget.
- No prompt.

## What your workflow needs

- A `SaveImage` output node (auto-detected).
- A `LoadImage` for the source image, plus the mask via **either** of:
  - a separate `LoadImageMask` node (`channel = "alpha"`) — bind it to **Stage mask (painter output)**; or
  - the `LoadImage`'s own **MASK output** — bind the `LoadImage`'s `image` input to **Upstream image + painted mask (alpha)**; ComfyTV bakes the painted mask into the image's alpha channel at run time.
- An online image-edit node that accepts an image + mask, or an equivalent local inpaint chain.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **Online GPT Erase** (`lama-erase.json` + `_preset.json`) — default. `LoadImage` + `LoadImageMask` → `OpenAIGPTImageNodeV3` → `SaveImage`. No local model or third-party plugin; consumes Comfy API credits.

## Plugin + model

None. The filename is retained for compatibility with existing configs; the workflow itself is no longer LaMa.
