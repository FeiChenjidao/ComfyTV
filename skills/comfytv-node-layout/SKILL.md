---
name: comfytv-node-layout
description: Create, connect, and arrange ComfyTV or native ComfyUI nodes with clear data flow. Use whenever an agent changes nodes, connections, routing, or layout on a ComfyTV canvas.
---

# ComfyTV Node Layout

Make canvas changes deliberate, compact, and easy to inspect.

## Inspect before writing

1. Call `server_info` and `get_canvas` before changing the canvas.
2. Use `graph_get` when native ComfyUI nodes or bridges are involved.
3. Inspect the affected stages and reuse existing loaders, processors, pickers, splitters, and review nodes when they already own the required role.
4. Confirm unfamiliar input and output names with `get_stage`; do not infer sockets from a node title.
5. Plan the affected chain and explicit positions before creating nodes.

Reuse fresh reads from the current turn. A stale mirror is a reason to reread once, not to create a duplicate node.

## Choose the correct routing node

- Use `ComfyTV.ImagesSplitStage` to unpack a `COMFYTV_IMAGES` group into `image1`, `image2`, `image3`, and subsequent single-image outputs.
- Use `ComfyTV.GridSplitStage` first when one composite grid image must become an image group, then use `ImagesSplitStage` only when separate output sockets are needed.
- Use `ComfyTV.ImagePickerStage` only to choose one candidate from alternative results. Never create one picker per batch item to split an image group.
- Reuse an existing splitter or picker when it already owns that role.

## Prefer ComfyTV image sources

- For an attached image or asset-library image, use `ComfyTV.AssetImageLoaderStage` and set its `asset_id`.
- Asset loaders emit on selection and should not be run separately.
- Put the primary edit or structure image first and references after it. Verify the resulting media order before running a downstream stage.
- Use native `LoadImage` plus `ComfyTV.BridgeToImage` only when the user explicitly needs native graph integration or the asset library cannot represent the source.
- Under that exception, execute the bridge path and verify its current output before running downstream.

## Layout

Build each logical chain left to right:

`source -> processor -> picker or splitter -> review/output`

- Always provide `pos` when adding a ComfyTV stage or native node.
- Keep sources left of consumers and keep unrelated workflows on separate rows.
- Leave at least 120 px between typical 400 px cards and at least 680 px between rows or vertical branches.
- Stack multiple references vertically in the source column, with the primary image first.
- For fan-out, place branch processors in one column and center the merge or review node in the next column.
- Do not move pre-existing nodes or run `arrange_canvas` without explicit approval.
- Give new processors descriptive titles using the user's language.

## Connect and execute

- Use `connect_stages` between ComfyTV stages and `graph_edit` for native graph connections.
- Use exact socket names returned by the tools. Do not add pass-through nodes unless a real type boundary requires one.
- Treat a node with no outputs as terminal; do not plan downstream processing from it.
- For an image picker, connect the batch to `batch`, use a 1-based `selected_index`, and verify that its pool populated.
- Do not run loader or live transform stages marked `runnable=false`; update them with `set_stage` and rely on live propagation.
- Before running, verify workflow selection, required inputs, media order, prompt, resolution, aspect ratio, and batch size.
- Run once, wait with `wait_stage`, and inspect actual output pixels before declaring success. Do not resubmit a stage that is still running.

## Finish cleanly

- Remove failed experiments, obsolete replacements, and disconnected nodes created during the current task.
- Keep pre-existing user nodes unless deletion was explicitly requested.
- Verify the affected topology once at the end with `get_canvas`; use `graph_get` as well only when native nodes are involved.
- Report the final chain with node ids, selected workflow, output location, and any unresolved node.
