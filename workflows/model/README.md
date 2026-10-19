**English** | [简体中文](README.zh.md)

# `model/` workflows

Workflows in this folder appear in the **3D Model Stage** dropdown. Take one upstream image (plus optional text / model inputs); produce a 3D asset. The stage's preview viewport renders whatever the workflow saves — meshes (`.glb`, `.gltf`, `.obj`, …), Gaussian splats (`.spz`, `.splat`, `.ksplat`, splat-`.ply`) and point clouds (`.ply`) are all supported, so mesh, splat and point-map workflows share this one folder.

## Stage inputs

- **Prompt** — optional; none of the shipped image-to-3D workflows consume it, but prompt-driven text-to-3D workflows can bind it.
- **Upstream images** — all shipped workflows lift `images.image0` into 3D.
- **Upstream text / models** (optional) — for workflows that take references.
- **Custom params** — quality knobs each preset exposes (see below); anything not exposed stays at the official template's default.

## What your workflow needs

- A `SaveGLB` (or compatible save node emitting a `ui["3d"]` result) at the end — splat pipelines get there via `SplatToFile3D`.
- A `LoadImage` for the upstream image.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

Shipped generative workflows keep official parameter defaults where applicable. Common custom param across generative workflows: `seed` (randomized per Run when unset).

- **Tripo** (`tripo.json` + `_preset.json`) — front/left/back/right views → **mesh** (GLB or FBX). Uses the Comfy Org Tripo API (`TripoMultiviewToModelNode`, default v3.1); Stage `images.image0`…`image3` bind to those views by index. `File3DFirst` picks the populated Tripo output so Stage `quad` on/off both work. Front required; side views optional.
- **Tripo P2** (`tripo-p2.json` + `_preset.json`) — front/left/back/right views → low-poly **mesh** (GLB or FBX) via `TripoPSeriesMultiviewToModelNode` (P2). All knobs live under the `model` DynamicCombo; `File3DFirst` picks GLB/FBX for Stage `quad`. Front required; API needs at least one side view.
- **Rodin Gen25** (`rodin-gen25.json` + `_preset.json`) — 1–5 images → **mesh** via `Rodin3D_Gen25_Image` (Rodin Gen-2.5 Image-to-3D). Stage sockets `images.image0`…`image4` match the Rodin node inputs 1:1; missing refs are pruned. Binds `material` / `mode` / `polygon_count` / `geometry_file_format` / `texture_mode` / `seed` / `tapose` / `hd_texture` / `texture_delight` / `addon_highpack`.
- **Stage image sockets** are always `images.image0`…`image4` (same names as Rodin). For Tripo, order is front / left / back / right / extra by index.

## Models referenced

Shipped workflows are **API-backed** (Tripo / Rodin) — no local 3D diffusion checkpoint. Configure Comfy Org API access in ComfyUI before Run. See also [docs/models.md](../../docs/models.md).

