**English** | [简体中文](agent-compat.zh.md)

# Queue / external-agent compatibility

> ComfyTV's Run button does **not** go through ComfyUI's queue: the page POSTs the stage graph to `/comfytv/stage_runs` and the plugin executes it in-process. Any external caller that only knows `POST /prompt` — the official `comfy` CLI, a script, an agent — therefore needs an explicit entry point. This is that contract.

## It is not that the nodes can't run

A stage node is an ordinary ComfyUI node (`is_output_node=True`): submit it to `/prompt` and `execute()` runs, which in turn runs the bound workflow. What you lose is the **browser-side run context**, in three pieces:

| What is lost | What it breaks | What the plugin does about it |
|---|---|---|
| Comfy.org credentials live only in the browser and ride along in `extra_data` | Bound paid API nodes (NanoBanana, …) fail with `Unauthorized: Please login first to use this node` | "Credential fallback" below |
| The result `ui` is delivered only to the **client id that submitted the prompt** | The card on your own browser stays empty, so the run looks like it never happened | Queue-triggered results are broadcast to every page |
| `@image_N` expansion, asset/pinned-batch materialization, `server` routing and the auto-picker all live in the frontend | A queued prompt gets no expansion — you can only send a plain prompt | Use the MCP `run_stage` when you need them |

## Three entry points

**1. MCP `run_stage` + `wait_stage` (most capable; recommended for agents)**

`run_stage` is executed by the open ComfyTV page and takes the exact path the Run button takes: credentials, `@` expansion, asset materialization, target-machine routing, progress and results all behave. The cost is that a page must be open.

**2. The queue: `POST /prompt` (works as-is for the `comfy` CLI)**

Nodes execute and results land in `/history` and `/api/jobs`. To make that path usable:

- **Credential fallback** (setting **Reuse Comfy login**, on by default): the plugin keeps the newest `auth_token_comfy_org` / `api_key_comfy_org` it saw from a browser run in memory and lends it to queued runs that arrive without one. Nothing is written to disk and it is dropped on restart; turn it off and such runs fail with a missing-credentials error instead.
- **Result broadcast**: when a queue-triggered stage finishes, the plugin broadcasts `comfytv-stage-run` (`external: true`) to every page. An idle card shows the result and never clobbers a run that page is driving itself.
- **Standard output refs**: besides ComfyTV's own `output` / `picked`, the stage's `ui` carries `images` / `videos` / `audio` entries shaped like a SaveImage/SaveVideo output (`{filename, subfolder, type, url}`). `/api/jobs` previews and external tools can read them without parsing private JSON.

```bash
# Runs just the stage node; read /history/<prompt_id> -> outputs["<node id>"]
curl -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' -d '{
  "client_id": "my-agent",
  "prompt": {
    "3129407217347710": {
      "class_type": "ComfyTV.ImageStage",
      "inputs": {"workflow": "NanoBanana 2.1", "main_prompt": "neon street at night", "project_id": "default"}
    }
  }
}'
```

**3. `/comfytv/agent/*` (no page needed)**

The same in-process executor, wrapped in `/prompt` + `/history` semantics for callers that can only post a prompt yet must not depend on a page:

| Endpoint | Meaning |
|---|---|
| `POST /comfytv/agent/prompt` | Same shape as `/prompt`, plus `output_node_ids`; the prompt must contain at least one ComfyTV node |
| `GET /comfytv/agent/history/{prompt_id}` | History-shaped result (also falls through to ComfyUI's own history) |
| `GET /comfytv/agent/queue` | `{"queue_running": [...], "queue_pending": []}` |
| `POST /comfytv/agent/runs/{prompt_id}/cancel` | Cancel and interrupt |

Finished runs are mirrored into ComfyUI's prompt history, so a client already polling `/history/{id}` or `/api/jobs/{id}` sees them unchanged.

```bash
curl -X POST http://127.0.0.1:8188/comfytv/agent/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {"main_prompt": "sunset over the sea"}}},
       "output_node_ids": ["7"], "client_id": "my-agent"}'
# -> {"prompt_id": "comfytv-agent-…"}
curl http://127.0.0.1:8188/comfytv/agent/history/<prompt_id>
```

## Caveats

- Credential fallback means **any local process that can `POST /prompt`** can spend your account's credits on paid API nodes (`--allow-spend` is a CLI-side switch, not a ComfyUI one). Turn it off if you don't want that.
- The queue path does not expand `@image_N` / `asset_refs`: put reference URLs in the prompt directly, or use `run_stage`.
- `/comfytv/agent/prompt` accepts graphs that contain ComfyTV nodes; it is not a generic workflow bypass.

## See also

- [Agent access (MCP)](mcp.md) — `run_stage` / `wait_stage` and the full tool list
- [Bridge nodes](bridges.md) — moving native image/video in and out of ComfyTV
