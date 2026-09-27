---
name: image-style-routing
description: Choose between reference-based image editing and upscaling. Use when a request involves a source image, style or material references, redraw, restoration, sharper detail, or larger output dimensions.
---

# Image Style Routing

Classify the requested visual change before adding nodes.

## Reference edit versus upscale

Use a reference-aware image-edit workflow such as `NanoBanana2` when a second image defines the desired style, material, texture, rendering language, or appearance.

- Treat image 1 as the structure and edit target.
- Treat image 2 as the style or material reference.
- Do not add an upscale workflow as an initial, parallel, or fallback path merely because the user also asks for clarity, texture, or more detail.
- Ask one question before creating nodes only when it is genuinely unclear whether the user wants a style change or same-style restoration.

Use Creative Upscale only when the design and material language are already correct and plausible same-style micro-detail reconstruction is desired. Confirm first when invented detail could damage important structure.

Use Precise Upscale or a preservation-oriented upscaler when the request is limited to larger pixel dimensions, sharpening, or denoising and semantic repainting is not wanted.

## Resolution

- Match the output to the requested delivery size; do not automatically turn a 4K source into 8K.
- A 4K reference edit normally stays 4K unless the user requests another size.
- Use 8K only for an explicit print, close-up, or texel-density requirement.

## Reference-edit setup

For source-to-reference style or material work:

1. Inspect both images.
2. Add one `ComfyTV.ImageStage` with an appropriate reference-aware workflow such as `NanoBanana2`.
3. Connect the source first and the reference second, then verify media order.
4. Match resolution and aspect ratio to the actual target instead of applying a fixed enlargement.
5. State that image 1 owns layout, silhouettes, boundaries, symmetry, colors, and proportions.
6. State that image 2 supplies only the requested style or material treatment.
7. Forbid unwanted objects, motifs, text, seams, halos, lighting changes, and geometry changes when those are realistic failure modes.
8. Run once and iterate only for a specific visible defect.

## Acceptance

Verify that the requested appearance changed while the source layout, silhouette, important boundaries, symmetry, and color regions remained usable. Reject extra subjects, decorative artifacts, or an output size that does not match the request. Remove failed experimental branches before finishing.
