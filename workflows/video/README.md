**English** | [简体中文](README.zh.md)

# `video/` workflows

Workflows in this folder appear in the **Video Stage** dropdown. Take 0..N text prompts, 0..N images, 0..N videos, plus an optional audio track; produce a video.

## Stage inputs

- **Prompt** — the stage's main input.
- **Upstream images**, **upstream videos**, **upstream text**, **upstream audio** (all optional) — consume as needed; e.g. i2v uses the first image, ia2v uses image + audio together.
- **Resolution** (`480P` / `720P` / `1080P`), **aspect ratio** (`16:9` / `9:16` / `1:1`, etc.).
- **Duration** (seconds).
- **Generate audio** (toggle), **random seed**, **negative prompt** (all optional).

## What your workflow needs

- A `SaveVideo` or `VHS_VideoCombine` output node.
- A `CLIPTextEncode` (or whatever encoder your model requires) for the prompt.
- A latent node sized by the stage's width / height / frame count (derived from the stage's resolution + aspect + duration).
- A `KSampler` (or model-specific sampler) driven by the stage's seed.
- i2v workflows: a `LoadImage` for the upstream image.

The frame-count formula uses tier maps + a per-model divisor (LTX divisor=8, Wan divisor=4).

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **Ignis Seedance 2.5 / Kling / Sora / PixVerse** appear directly in the Video Stage workflow selector and generate through the Ignis HTTP API without requiring the local Ignis CLI. The parameter panel only exposes modes, aspect ratios, resolutions, and duration controls supported by the selected model. Credentials are loaded from `IGNIS_CLI_TOKEN`, `ComfyTV/secrets/ignis-token`, or the compatible `~/.ignis/config.json` fallback.
- **Seedance 2.5 Official** (`seedance-2.5-official.json` + `_preset.json`) uses the official ComfyUI Credits API nodes. One Video Stage workflow supports text-to-video, first-frame image-to-video, and first-last-frame transition through the mode selector; lazy switches run only the selected API branch. Supported controls are 480P / 720P / 1080P / 4K, 4-30 seconds, optional generated audio, and the official text-to-video aspect ratios.

## Models referenced

See [docs/models.md](../../docs/models.md).
