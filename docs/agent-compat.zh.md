[English](agent-compat.md) | **简体中文**

# 队列 / 外部 Agent 兼容

> ComfyTV 的 Run 按钮**不走 ComfyUI 队列**(页面把 stage 图 POST 到 `/comfytv/stage_runs`,插件进程内执行)。任何只会 `POST /prompt` 的外部调用方 —— 官方 `comfy` CLI、脚本、agent —— 因此需要一条明确的入口。本文是那份契约。

## 为什么不是「不能执行」

stage 节点本身就是普通 ComfyUI 节点(`is_output_node=True`),`/prompt` 提交进来会正常执行,`execute()` 里再去跑绑定的工作流。真正会丢的是**浏览器里的运行上下文**,共三样:

| 丢的东西 | 后果 | 插件怎么补 |
|---|---|---|
| Comfy.org 登录凭据只存在浏览器,随 `extra_data` 下发 | 绑了付费 API 节点(如 NanoBanana)立刻 `Unauthorized: Please login first to use this node` | 见下一节「凭据兜底」 |
| 结果 `ui` 只回给**提交该 prompt 的 `client_id`** | 你自己那台浏览器上的卡片一直是空的,看着像没执行 | 队列触发的结果会广播给所有页面 |
| `@image_N` 展开、资产/置顶批次物化、`server` 路由、auto-picker 都在前端 | 队列提交的 prompt 不会做这些展开,只能传纯 prompt | 需要这些能力就改用 MCP 的 `run_stage` |

## 三条入口

**1. MCP `run_stage` + `wait_stage`(能力最全,推荐 agent 用)**

`run_stage` 由打开着的 ComfyTV 页面执行,走的就是 Run 按钮那条路:登录态、`@` 展开、资产物化、目标机器路由、进度与结果全都对。代价是需要开着页面。

**2. 队列 `POST /prompt`(`comfy` CLI 原样可用)**

节点能跑,结果也进 `/history` 与 `/api/jobs`。为了让这类运行可用:

- **凭据兜底**(设置项 **复用 Comfy 登录态**,默认开):插件把最近一次浏览器运行带来的 `auth_token_comfy_org` / `api_key_comfy_org` 记在内存里,借给没带凭据的队列运行。凭据不落盘、重启即失效;关掉后这类运行会按缺凭据报错。
- **结果广播**:队列触发的 stage 完成后,插件向所有页面广播一条 `comfytv-stage-run`(`external: true`)。空闲的卡片会直接显示结果,不会覆盖本页自己正在跑的那次。
- **标准输出引用**:stage 的 `ui` 里除了 ComfyTV 自己的 `output` / `picked`,还带上 `images` / `videos` / `audio` 三键(每项 `{filename, subfolder, type, url}`),与 SaveImage/SaveVideo 的形状一致 —— `/api/jobs` 的预览和外部工具不用解析私有 JSON。

```bash
# 只跑 stage 节点,产出在 /history/<prompt_id> 的 outputs["<node id>"]
curl -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' -d '{
  "client_id": "my-agent",
  "prompt": {
    "3129407217347710": {
      "class_type": "ComfyTV.ImageStage",
      "inputs": {"workflow": "NanoBanana 2.1", "main_prompt": "雨夜街头,霓虹", "project_id": "default"}
    }
  }
}'
```

**3. `/comfytv/agent/*`(无需页面)**

把同一个进程内执行器包成 `/prompt` + `/history` 语义,给「只能发 prompt、又不想依赖页面」的调用方使用:

| 端点 | 说明 |
|---|---|
| `POST /comfytv/agent/prompt` | 与 `/prompt` 同形,额外支持 `output_node_ids`;prompt 里至少要有一个 ComfyTV 节点 |
| `GET /comfytv/agent/history/{prompt_id}` | history 形状的结果(也兼容查询 ComfyUI 自己的 history) |
| `GET /comfytv/agent/queue` | `{"queue_running": [...], "queue_pending": []}` |
| `POST /comfytv/agent/runs/{prompt_id}/cancel` | 取消并中断 |

运行结束后,记录会被镜像进 ComfyUI 的 prompt history,所以已经轮询 `/history/{id}` 或 `/api/jobs/{id}` 的客户端无需改动就能看到。

```bash
curl -X POST http://127.0.0.1:8188/comfytv/agent/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt": {"7": {"class_type": "ComfyTV.ImageStage", "inputs": {"main_prompt": "海边日落"}}},
       "output_node_ids": ["7"], "client_id": "my-agent"}'
# -> {"prompt_id": "comfytv-agent-…"}
curl http://127.0.0.1:8188/comfytv/agent/history/<prompt_id>
```

## 注意

- 凭据兜底意味着**本机任何能 `POST /prompt` 的进程**都能以你的账号调用付费 API 节点(`--allow-spend` 这类开关在 CLI 侧,不在 ComfyUI 侧)。不需要就关掉它。
- 队列路径不会展开 `@image_N` / `asset_refs`:要在 prompt 里直接写引用 URL,或改用 `run_stage`。
- `/comfytv/agent/prompt` 只接受含有 ComfyTV 节点的图,不是任意工作流的旁路。

## 另见

- [Agent 接入(MCP)](mcp.zh.md) — `run_stage` / `wait_stage` 与全部工具
- [Bridge 节点](bridges.zh.md) — 让原生节点的一路图像/视频进出 ComfyTV
