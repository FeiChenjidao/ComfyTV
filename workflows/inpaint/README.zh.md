[English](README.md) | **简体中文**

# `inpaint/` 工作流

这个目录下的工作流出现在 **Inpaint** 下拉框。用户在源图上涂抹 mask,工作流按提示词重新生成被涂的区域。

## stage 提供的输入

- **源图**(必需) , 来自上游。
- **mask**(必需) , 用户用 painter widget 涂出的区域。
- **提示词** , 被 mask 的区域应该变成什么。
- **随机 seed**。

## 工作流需要包含

- 一个 `SaveImage` 输出节点(自动检测)。
- 一个 `LoadImage` 接源图;mask 走以下**两种方式之一**:
  - 单独的 `LoadImageMask` 节点(`channel = "alpha"`),绑定到 **Stage mask (painter output)**;
  - 直接用 `LoadImage` 自己的 **MASK 输出**(在 ComfyUI 自带 mask 编辑器上画蒙版的常见做法),把 `LoadImage` 的 `image` 输入绑定到 **Upstream image + painted mask (alpha)**。运行时 ComfyTV 会把涂抹的 mask 烘进图片的 alpha 通道,单个 `LoadImage` 同时输出图和 mask。
- 一个 `CLIPTextEncode` 接提示词。
- 模型对应的 inpaint conditioning(Flux Fill 用 `InpaintModelConditioning`、SD1.5 用 `VAEEncodeForInpaint`)。
- `KSampler` 一个,`denoise=1.0` 完全重生成被 mask 区域。

加自己的工作流见 [docs/custom-workflows.zh.md](../../docs/custom-workflows.zh.md);具体绑定在画布上选中 stage 后通过左侧 **ComfyTV** 侧边栏配,详见 [docs/sidebar-config-editor.zh.md](../../docs/sidebar-config-editor.zh.md)。

## 当前内置

- **GPT局部重绘**（`GPT局部重绘.json` + `_preset.json`），使用 `OpenAIGPTImageNodeV2` 做蒙版重绘。
- **Nanobanana 局部重绘**（`Nanobanana 局部重绘.json` + `_preset.json`），使用 `GeminiNanoBanana2V2` 做蒙版重绘。

两个工作流都使用 ComfyUI API 节点，需要登录 Comfy 账号并具备相应模型的使用权限。
