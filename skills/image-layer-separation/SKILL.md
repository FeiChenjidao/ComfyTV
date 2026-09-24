---
name: image-layer-separation
description: Split a ComfyTV image into independently editable semantic layers with a broad first pass and optional user-directed detail passes. Use for characters, clothing, hair, shoes, accessories, backgrounds, and other meaningful parts; do not use for geometric cropping, grids, proportional slicing, image batches, or splitting an existing image group.
---

# Progressive Layer Separation

## Default capability

- Use `ComfyTV.LayerSeparationStage`.
- Prefer the available `layer-separation` workflow. The known workflow is `Seedream5.0Pro 图层分离`.
- Its underlying node is `ByteDanceSeedreamLayerSeparationNode`.
- The main result is `layer_stack`, which contains the background plate, layer order, positions, names, bounds, and related metadata.
- Preview `layer_stack` directly in the external compositor/previewer. PSD export is not required.
- The provider returns one background plate plus transparent foreground layers. Never count the background plate as a transparent layer.

## When to trigger

Trigger when the user asks to separate a person, clothing, hair, shoes, accessories, background, or similar semantic parts into independently editable layers. For an ambiguous request to "split" an image, ask one question only when context does not establish whether semantic layers or geometric slices are intended.

Do not use this Skill for rectangular crops, grids, proportional splitting, cutting one image into several files, or splitting an existing image batch.

## Progressive strategy

Use two stages of detail: a broad initial pass followed by optional user-directed refinement. Do not attempt an exhaustive decomposition in the first prompt.

### Initial pass

- Separate the subject into broad, useful semantic groups.
- Request no more than eight transparent foreground layers. The separately returned background plate does not count toward this limit.
- Keep the prompt short and general. Do not enumerate small garment parts, patterns, jewelry, trim, or occluded details unless the user explicitly requested them.
- For a character, prefer broad groups such as the main character, main garment masses, major left/right appendages or sleeves, footwear, hair/head, and large accessories.
- Keep fine patterns and small decorations with their owning major layer during the initial pass.
- Do not mechanically split a dress into unrelated clothing categories. Follow the visible garment structure.
- A suitable default prompt is: `Separate the character into up to 8 major transparent layers at their original positions.`
- Do not describe the background as a transparent layer. Let the workflow produce the background plate separately.

### Refinement question

After the initial result passes inspection, ask whether the user wants any layer split into finer parts. Name useful candidates from the actual `layer_stack`; do not propose layers that are absent. A concise question is: `当前已完成大致分层。需要把哪一层继续细拆？`

Do not ask this question when the user already named a layer to refine. Proceed directly with that layer.

### Detail pass

- Refine only the layer named by the user. Do not rerun the entire character or redesign unrelated layers.
- Use the chosen full-canvas layer image as the next separation input so its original placement is preserved. Use an image picker when the stage returns a batch.
- Keep each detail pass to no more than eight transparent sublayers.
- Describe only meaningful subparts of the selected parent layer, using a short natural-language prompt.
- Example for a dress: `Separate the dress into major editable parts: bodice, skirt, train, left sleeve, right sleeve, and large decorations.`
- Do not repeat the background, face, hair, shoes, or other character parts when refining the dress unless they genuinely belong to the selected layer.
- Use `<bbox>left top right bottom</bbox>` only when the target is spatially ambiguous. Coordinates are normalized from 0 to 1000, not pixels.
- Keep the accepted broad result as the baseline. Replace only the refined parent layer with its child layers in the detailed composition.

## Execution

1. Inspect the current canvas, source image, available stages, and the `layer-separation` workflow.
2. Reuse the existing image source and avoid unrelated nodes.
3. Add or reuse `ComfyTV.LayerSeparationStage` and connect the source to its `image` input.
4. Run the broad initial prompt and wait for completion.
5. Inspect the complete `layer_stack`, not only a flattened preview.
6. Verify the initial pass, then ask whether the user wants a specific layer refined.
7. For refinement, isolate the requested parent layer, run a focused detail prompt, and inspect the child `layer_stack`.
8. Leave already accepted layers unchanged.

## Prompt discipline

- Prefer concise natural language over an exhaustive production specification.
- Do not demand an exact exhaustive layer list during the broad first pass.
- Do not combine conflicting ownership, such as placing the whole character inside the dress layer while also separating multiple body or clothing parts.
- Do not add reconstruction, quality, alignment, and edge requirements to every prompt. Those are acceptance criteria, not prompt boilerplate.
- If the same image succeeds with a short prompt but a longer controlled prompt returns `image content could not be processed`, treat it as a provider-side controlled-prompt failure. Shorten the prompt or refine one parent layer at a time; do not claim the image is invalid.

## Acceptance

For the initial pass, verify that the background plate is separate, there are no more than eight transparent foreground layers, major parts can be moved independently, names are reasonable, positions and stacking are correct, and recomposition aligns with the source.

For a detail pass, verify that the requested parent layer is divided into useful child layers, unrelated content has not leaked into them, transparent edges are clean, original placement is preserved, and the refined children recompose to the parent.

A successful run alone is not completion. If a result is missing, merged, badly edged, or incorrectly split, change only the description for that layer and retry.
