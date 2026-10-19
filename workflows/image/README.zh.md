[English](README.md) | **简体中文**

# `image/` 工作流

这个目录下的工作流出现在 **Image Stage** 下拉框。接收提示词 + 0..N 个参考图,产出一张或多张图。

## stage 提供的输入

- **提示词** + 可选**负向提示词**。
- **参考图**(可选) , i2i / 多参考工作流会用上游接进来的图。
- **分辨率**(`1K` / `2K` / `4K`)、**比例**(`1:1`、`16:9` 等)、**批量大小**(1..8)、**随机 seed**。

## 工作流需要包含

- 一个 `SaveImage` 输出节点(自动检测;多张输出会合到 `COMFYTV_IMAGES` 批次里)。
- 按 preset 绑定消费 stage 提示词 / 图片 / 尺寸 / seed 的节点。

加自己的工作流见 [docs/custom-workflows.zh.md](../../docs/custom-workflows.zh.md);具体绑定在画布上选中 stage 后通过左侧 **ComfyTV** 侧边栏配,详见 [docs/sidebar-config-editor.zh.md](../../docs/sidebar-config-editor.zh.md)。

## 当前内置

- **NanoBanana2**(`NanoBanana2.json` + `_preset.json`) — Gemini NanoBanana 2 API 生图 / 编辑(`GeminiNanoBanana2V2`)。最多 3 张上游参考图;比例走 stage。需要在 ComfyUI 里配好 Gemini / NanoBanana API 凭证。
- **GPT Image 2.5**(`GPT_Image_2.5.json` + `_preset.json`) — OpenAI GPT Image 2.5 API(`OpenAIGPTImageNodeV2`)。最多 3 张上游参考图;尺寸 / 背景 / 质量等旋钮在 preset 里。需要在 ComfyUI 里配好 OpenAI API 凭证。

## 需要的模型

两个内置工作流都是 **API 调用**——不用下本地扩散模型。Run 前在 ComfyUI / 节点设置里配好对应 API key。
