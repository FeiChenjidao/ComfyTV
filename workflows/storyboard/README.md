**English** | [简体中文](README.zh.md)

# `storyboard/` workflows

Workflows in this folder appear in the **Storyboard** dropdown. Take a story / premise prompt; produce a structured shot list (**not images** — per-shot image generation happens downstream in the Shot Images stage).

## Stage inputs

- **Prompt** — the user's premise / brief.

## What your workflow needs

- A text-gen node that emits a JSON string matching the `COMFYTV_STORYBOARD` shape: `{"shots": [{shot_no, duration, prompt, scene_purpose, character, ...}]}`.
- The prompt input wired to the LLM's prompt port.
- Result type `graph_output_first` pointing at that node's slot 0.

Full field definitions are in `_fake_storyboard` in `nodes/stages.py`.

To add your own workflow see [docs/custom-workflows.md](../../docs/custom-workflows.md); to configure per-node bindings, select the stage on the canvas and open the left **ComfyTV** sidebar — see [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md).

## What's here today

- **Online GPT Storyboard** (`online-gpt-storyboard.json` + `.api.json` + `_preset.json`) — default. Produces the 16-field shot list online without loading a local LLM.
- **Local Qwen3 Storyboard** (`local-qwen3-storyboard.json` + `_preset.json`) — local fallback.
