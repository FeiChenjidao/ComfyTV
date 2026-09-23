[English](bot.md) | **简体中文**

# ComfyTV Bot

> 内嵌在侧边栏的聊天代理,直接驱动你的画布:说出想要什么,它就搭节点、跑工作流、等渲染、亲眼看结果、继续迭代 — 由你本机已装的 agent CLI 驱动,任何地方都不存 API key。

## 是什么

**ComfyTV Bot** 是侧边栏的聊天面板(✨ 图标),背后是本机的 agent CLI。你发的每条消息都会启动一个 agent 回合,它能使用完整的 [ComfyTV MCP 工具集](mcp.zh.md) — 而且*只有*这套工具:能读写画布、跑渲染、看图、管理资产库,但没有 shell、没有文件系统、没有其他任何工具。

典型用法:

- *"加一个 Z-Image Turbo 的图片节点,提示词写夜里的霓虹猫,16:9,跑起来。"*
- *"用那张图做参考出一段 5 秒图生视频,等它跑完,质检一下首帧。"*
- *"这是我的歌和卡点歌词——按段落切开,逐段做一支音频驱动的 MV。"*
- *"看看我的画布,告诉我视频节点为什么失败了。"*
- *"打开导演台时间线,把第 3 段用更慢的运镜重拍一条。"*
- *"我刚 link 了个新工作流 — 帮我把 seed、宽、高绑上。"*

## 不碰 API key,这是设计

Bot 不直接调用任何云端模型 API,ComfyTV 也永远不存 key。它驱动的是**你机器上已经装好的 agent CLI**(用 CLI 自己的登录态),或者通过 Local LLM / ComfyUI LLM provider 驱动**你自己硬件上跑的模型**。当前内置六个:

| Provider | 安装 | 登录 | 附件 |
| --- | --- | --- | --- |
| [Claude Code](https://claude.com/claude-code) | `npm install -g @anthropic-ai/claude-code` | 运行 `claude` 登录一次 | 图片/视频/音频 |
| [Codex](https://developers.openai.com/codex) / ChatGPT CLI | `npm install -g @openai/codex`（Windows 同） | `codex login` | 图片/视频/音频 |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/zh/) | 官方安装脚本(见其文档) | 运行 `qwen` 后 `/auth` | 暂不支持 |
| [Cursor CLI](https://cursor.com/docs/cli/overview) | `curl https://cursor.com/install -fsS \| bash`(Windows:`irm 'https://cursor.com/install?win32=true' \| iex`) | `agent login` | 图片/视频/音频 |
| Local LLM | 任意 OpenAI 兼容的本地模型服务 | 无 — 在设置里填端点 URL 即可 | 暂不支持 |
| ComfyUI LLM | 往 `models/text_encoders` 放一个 Qwen3 或 Gemma 系权重 | 无 | 暂不支持 |

前置条件:

1. 至少装好一个 agent CLI 并登录 — 或者跑一个本地模型服务并在设置里填上它的 URL。
2. 在 ComfyTV **设置 → Agent 与 MCP** 里,先开 **MCP 服务**,再开 **ComfyTV Bot**(Bot 依赖 MCP — 那是 agent 触达画布的通道)。

Windows 上 Codex 特别容易「已安装但 Bot 检测不到」:

- **Microsoft Store / ChatGPT 桌面版 ≠ CLI**。Store 包(`OpenAI.Codex`)自带的 `resources\codex.exe` 受 AppX 沙箱限制,外部进程无法直接调用,也不会注册 `codex` 命令。Bot 需要的是 npm 装的 `@openai/codex` CLI(`codex exec`)。
- 另:ComfyUI 进程的 PATH 往往不含 npm 全局目录。装好 CLI 后可用下面任一方式:
  - 终端执行 `where codex` 确认路径,然后设环境变量 `COMFYTV_CODEX_PATH` 指向该 `.exe` / `.cmd`(再重启 ComfyUI)
  - 或把 npm 全局 bin(`%APPDATA%\npm`)加进系统 PATH 后重启 ComfyUI
- Bot 面板点*重新检测*看 Codex 是否出现;若显示需登录,再跑一次 `codex login`(本机若已有 `~/.codex\auth.json`,通常可复用桌面版登录态)

有多个 provider 可用时,➕ 按钮会让你选新对话用哪个引擎;每个对话记住自己的 provider。一个都检测不到时,面板显示安装引导而不是聊天框。

隔离策略按引擎各自落实:Claude Code 走每轮独立的严格 MCP 配置+工具白名单;Codex 的 `codex exec` 沙箱限定在 bot 工作目录,shell、联网搜索和 ChatGPT 桌面插件全部关闭,该回合只保留 ComfyTV 一个 MCP 服务;`approval_policy=never` 避开自动审察(自定义中转会把审察 prompt 判违规),同时给 ComfyTV 设 `default_tools_approval_mode=approve`,否则 headless 下 MCP 会被 never 策略直接拒绝;真正开跑仍走 ComfyTV 自己的对话审批;Qwen Code 走 bot 工作目录内的项目级 `.qwen/settings.json`(只挂 ComfyTV MCP,内置 shell/文件工具全部排除);Cursor CLI 在隔离的 bot-home 里跑 `agent -p`,项目级 `.cursor/mcp.json`(只挂 ComfyTV MCP)和 `.cursor/cli.json` 禁止 shell/写文件/联网抓取 — 你的全局 `~/.cursor/mcp.json` 永远不被碰。

## Local LLM provider

Local LLM 完全不需要 agent CLI:ComfyTV 自己跑 agent 循环,对接任何 OpenAI 兼容端点 — LM Studio、llama.cpp 的 `llama-server`、vLLM、Ollama 都行。把 **设置 → Agent 与 MCP → Local LLM 端点** 指向服务的 base URL(如 `http://127.0.0.1:1234/v1`),模型建议直接来自端点的 `/models` 真实列表。仅限免 key 的本地端点 — 与"不存 key"的铁律一致(局域网服务非要 token 的话,认 `COMFYTV_LOCAL_LLM_API_KEY` 环境变量,但永远不落库)。

几个值得知道的细节:

- 对话历史由 ComfyTV 自己的记录重放(端点不持有会话),重启服务器也不丢上下文。
- 只暴露核心画布工具集(搭建/运行/等待/看图),不给全量目录 — 小模型会被塞爆。
- `wait_stage` 由 provider 侧循环续片,渲染真正结束才回到模型。
- 如果装了 [LM Studio](https://lmstudio.ai) 的 `lms` CLI,渲染期间会自动把驱动模型从显存卸掉、渲完再装回 — 单卡机器上出图时画布独占整张卡。

## ComfyUI LLM provider

ComfyUI LLM 更进一步:连外部服务也不需要 — 推理直接跑在 **ComfyUI 本体内**,用的就是核心 `TextGenerate` 节点那套文本编码器推理栈。往 `models/text_encoders` 放一个可生成的 Qwen3 或 Gemma 系权重(如 Qwen3 8B,或 LTX2 已在用的 Gemma 3/4 编码器),provider 即可用;在**设置 → Agent 与 MCP → ComfyUI LLM 模型**里选权重(留空 = 自动取第一个)。Qwen3 有原生工具调用训练、最适合当驱动;Gemma 靠指令跟随同一约定。

对比 Local LLM:

- 零安装零配置 — 不需要端点 URL,不需要额外服务进程。
- 显存由 ComfyUI 的模型管理统一仲裁:渲染期间 LLM 自动 offload,下一轮对话自动装回 — 不再需要 `lms` 那种手工腾挪。
- 工具调用走 Qwen3 训练所用的 Hermes 约定(`<tool_call>` 块),由 ComfyTV 负责渲染与解析。
- 回合经由 `/comfytv/llm/v1` 的 OpenAI 兼容 shim 逐个处理(不支持流式)— bot 开启期间,本机其他应用也可以指向这个端点复用同一模型。

## 面板用法

- **对话持久化**:列表支持置顶、改名、删除;每个对话跨回合保持完整上下文(CLI 恢复同一会话)。
- **流式**:回复实时流出;工具活动折叠进一个抽屉(默认收起),逐调用显示条目(如 `add_stage`、`wait_stage`),你能实时看它操作画布 — 节点在画布上边长边跑。
- **附件**:支持附件的 provider 可以通过 📎 按钮、拖文件、从资产库挑选或直接粘贴,发送图片/视频/音频。视频会附中间帧、音频会附波形图,agent 是真的"看得见"你发了什么。
- **技能**:输入框打 **`/`** 唤出技能面板 — 选一个已安装的 [Agent Skill](skills.zh.md),它会变成消息上的一枚 chip;agent 先读该技能,再按其指令执行任务。
- **停止**按钮中断当前回合,已有的部分输出保留。
- 切走侧边栏(或收起面板)不会打断进行中的回合 — 回合在服务器侧继续,回来时记录自动补齐。

## 简述原理

每个回合都以 headless 模式启动一个全新 CLI 进程,锁死在 ComfyTV 的 MCP 服务上(Claude Code 用 `--strict-mcp-config` 和 `mcp__comfytv__*` 工具白名单;其他 CLI 用各自等价的锁定),并恢复该对话的会话保证连续性。对话状态由 CLI 持有;ComfyTV 数据库只存一份用于显示的记录镜像。画布写操作仍遵循 MCP 规则——由打开着的 ComfyTV 页面执行，Comfy Desktop 与浏览器都可以。

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| 侧边栏没有 ✨ 图标 | **启用 ComfyTV Bot** 没开(设置 → Agent 与 MCP),它又依赖**启用 MCP 服务** |
| 面板显示安装引导 | 没检测到 agent CLI — 按上表装一个并登录,然后点*重新检测*;Codex 在 Windows 可设 `COMFYTV_CODEX_PATH` |
| Codex 显示但提示 login | 运行 `codex login`(登录态写在 `~/.codex/auth.json`) |
| 工具报 Automatic approval review failed / usage policy | 旧版 Bot 把画布工具送给 Codex 自动审察,自定义中转会把审察 prompt 判违规。更新 ComfyTV 后**重启 ComfyUI** |
| 工具报 MCP tool call requires approval, but approval policy is never | headless exec 会拒绝未预批准的 MCP。当前 Bot 只给 ComfyTV 服务设了 `default_tools_approval_mode=approve`;更新后请**重启 ComfyUI** |
| Bot 说够不到画布 | 没有打开的 ComfyTV 页面（Comfy Desktop 或浏览器）；或服务器重启后 websocket 断了——刷新该页面 |
| 长渲染时 Bot 好像没动 | 它在 `wait_stage` 里阻塞等待 — 工具条目能看到;正常且省钱 |

## 另见

- [Agent 接入(MCP)](mcp.zh.md) — Bot 用的工具集,以及如何接入外部 agent
- [Agent Skills](skills.zh.md) — Bot(和外部 agent)可调用的指令包
- [侧边栏](sidebar.zh.md) — 带两个开关的设置面板
