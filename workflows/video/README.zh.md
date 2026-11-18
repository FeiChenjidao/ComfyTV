[English](README.md) | **简体中文**

# `video/` 工作流

这个目录下的工作流出现在 **Video Stage** 下拉框。接收 0..N 段文本提示词、0..N 张图、0..N 段视频,以及可选音轨,产出一段视频。

## stage 提供的输入

- **提示词** , stage 的主输入。
- **上游图**、**上游视频**、**上游文本**、**上游音频**(均可选) , 工作流按需消费,比如 i2v 用第一张图,ia2v 同时用图 + 音频。
- **分辨率**(`480P` / `720P` / `1080P`)、**比例**(`16:9` / `9:16` / `1:1` 等)。
- **时长**(秒数)。
- **生成音频**(开关)、**随机 seed**、**负向提示词**(均可选)。

## 工作流需要包含

- 一个 `SaveVideo` 或 `VHS_VideoCombine` 输出节点。
- 一个 `CLIPTextEncode`(或模型自己要求的 encoder)接提示词。
- latent 节点接 stage 的宽 / 高 / 帧数(由 stage 的分辨率 + 比例 + 时长推导出)。
- `KSampler`(或模型专属采样器)一个,用 stage 的 seed。
- i2v 工作流:一个 `LoadImage` 接上游图。

视频帧数算法用 tier 表 + 帧长公式,具体到每个模型(LTX divisor=8,Wan divisor=4)。

加自己的工作流见 [docs/custom-workflows.zh.md](../../docs/custom-workflows.zh.md);具体绑定在画布上选中 stage 后通过左侧 **ComfyTV** 侧边栏配,详见 [docs/sidebar-config-editor.zh.md](../../docs/sidebar-config-editor.zh.md)。

## 当前内置

- **Ignis Seedance 2.5 / Kling / Sora / PixVerse**：直接出现在 Video Stage 的工作流下拉框中，通过 Ignis HTTP API 远程生成，不依赖本机安装 Ignis CLI。模型切换后，参数面板会只显示该模型支持的模式、比例、清晰度和时长。Token 从 `IGNIS_CLI_TOKEN`、`ComfyTV/secrets/ignis-token` 或兼容的 `~/.ignis/config.json` 读取。
- **Seedance 2.5 Official**（`seedance-2.5-official.json` + `_preset.json`）：使用 ComfyUI 官方积分 API 节点。一个 Video Stage 工作流通过模式选择同时支持文生视频、图生视频和首尾帧；懒切换只执行当前选中的 API 分支。支持 480P / 720P / 1080P / 4K、4–30 秒、可选生成音频，以及官方文生视频比例。

## 需要的模型

模型清单见 [docs/models.zh.md](../../docs/models.zh.md)。
