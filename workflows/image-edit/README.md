**English** | [简体中文](README.zh.md)

# `image-edit/` workflows

Workflows in this folder appear in the **Image Edit** dropdown. Wire a source image + an instruction prompt; produce a re-imagined version — same overall composition, content changed per the prompt. Distinct from **Inpaint** (mask-based local edit) and **Outpaint** (canvas extension).

## Stage inputs

- **Source image** (required) — from upstream.
- **Prompt** — the edit instruction.
- **Random seed**.

## What your workflow needs

- A `SaveImage` output node (auto-detected).
- A `LoadImage` for the source image.
- A `CLIPTextEncode` for the prompt.
- The model's edit conditioning node (`InstructPixToPixConditioning` / Flux Canny's `Canny` + `InstructPixToPixConditioning` / Qwen-Edit's `TextEncodeQwenImageEditPlus`, etc.).
- A `KSampler` driven by the stage's seed.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **Flux Canny Edit** (`flux-canny-edit.json` + `_preset.json`) — uses the upstream image as a Canny edge map and repaints per the prompt. Only the silhouette survives; colors come from the prompt. Tested working.
- **Qwen Edit 2511** (`qwen-edit-2511.json` + `_preset.json`) — instruction editing via Qwen-Image-Edit 2511 + Lightning 4-step. Preserves the subject's colors and materials while the instruction changes background/lighting or adds elements — describe the change, not the whole scene. The 3D-model-stage **Product Shot** action spawns this workflow with a seeded render-to-product-photo instruction. Tested working.
- **Qwen Image 2.1 Edit** (`qwen-image-2.1-edit.json` + `_preset.json`) — the official Qwen Image 2.1 edit graph with up to 10 images: the stage's first image is the edit target (output follows its size), the rest are references. `LoadImage` ×10 → `TextEncodeQwenImage21` (Qwen3-VL-8B encoder), whose `latent` output already matches the target size, so there is no `VAEEncode`; unused slots are pruned, so 1–10 images all run. Refer to images with the stage's `@image_1`..`@image_10` mentions (type `@` in the prompt, or drop assets onto the media strip); the preset sets `mention_style: qwen_tags`, so they reach the model as `<image1>`..`<image10>` ("put the jacket from `@image_2` on the person in `@image_1`"). 25 steps, cfg 1, `QwenImage21Cache` on auto. Tested working (~20–27 s at 1K on a 5090).

## Models referenced

- `flux1-canny-dev_fp8.safetensors` → `models/diffusion_models/`
- `clip_l.safetensors` + `t5xxl_fp16.safetensors` → `models/clip/`
- `ae.safetensors` → `models/vae/`
- Qwen Edit 2511: `qwen_image_edit_2511_fp8mixed.safetensors` (diffusion_models), `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` (loras), `qwen_2.5_vl_7b_fp8_scaled.safetensors` (clip), `qwen_image_vae.safetensors` (vae)
- Qwen Image 2.1 Edit: `qwen_image_2.1_int8_convrot.safetensors` (diffusion_models), `qwen3vl_8b_int8_convrot.safetensors` (text_encoders), `qwen_image_2.1_vae_bf16.safetensors` (vae) — <https://huggingface.co/Comfy-Org/Qwen-Image-2.1>; needs ComfyUI v0.37+ (`TextEncodeQwenImage21`)
