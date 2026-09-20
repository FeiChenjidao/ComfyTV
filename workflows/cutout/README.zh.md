[English](README.md) | **简体中文**

# `cutout/` 工作流

这个目录下的工作流出现在 **Cutout** 下拉框。连接一张上游图,返回主体被分割出来、背景替换为透明 alpha 通道的同一张图。

## stage 提供的输入

- **源图**(必需) , 来自上游。没有提示词,没有可调 widget。

## 工作流需要包含

- 一个 `SaveImage` 输出节点(自动检测)。
- 一个 `LoadImage` 接源图。
- 一个背景去除节点(BiRefNet、BriaRMBG 等),同时输出 `IMAGE`(主体)和 `MASK`。
- 一个 `JoinImageWithAlpha` 或等价节点把主体 + mask 合成透明背景 PNG(部分分割链内部已经做了这步)。

加自己的工作流见 [docs/custom-workflows.zh.md](../../docs/custom-workflows.zh.md);具体绑定在画布上选中 stage 后通过左侧 **ComfyTV** 侧边栏配,详见 [docs/sidebar-config-editor.zh.md](../../docs/sidebar-config-editor.zh.md)。

## 当前内置

- **BiRefNet Cutout**(`birefnet-cutout.json` + `_preset.json`) , 改自 ComfyUI 的 `utility_birefnet_remove_background` 模板。顶层:`LoadImage` → BiRefNet 子图 → `SaveImage`。子图封装 `RemoveBackground` / `LoadBackgroundRemovalModel` / `InvertMask` / `JoinImageWithAlpha`。
- **Qwen Image 2.1 Cutout**(`qwen-image-2.1-cutout.json` + `_preset.json`) , 生成式抠图,来自官方 `image_qwen_image_2_1_background_removal` 模板:`LoadImage` → `TextEncodeQwenImage21`(固定指令 *"Remove the background, and output a PNG image"*)→ `KSampler` → 2.1 的 VAE 直接解出 alpha 通道,`SaveImage` 存 RGBA PNG,不经过分割模型和 `JoinImageWithAlpha`。复杂 / 图形化背景上比 BiRefNet 干净(波普拼贴源图上 BiRefNet 把头顶一块半调网点当成前景、头发边缘留绿色溢色,2.1 都没有),但主体是重新生成的,不是蒙版,细节可能有微小变化;5090 上 1K 模型加载后约 10 秒(冷启动约 45 秒,BiRefNet 约 7 秒)。需要有明确的前景主体:喂一张没有主体的风景图,它会整张返回全透明。要像素级保真的产品抠图仍用 BiRefNet。测试通过。

## 需要的模型

- `birefnet.safetensors` , 放进 `models/background_removal/`,约 900 MB。下载:<https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors>
- Qwen Image 2.1 Cutout:`qwen_image_2.1_int8_convrot.safetensors` → `models/diffusion_models/`、`qwen3vl_8b_int8_convrot.safetensors` → `models/text_encoders/`、`qwen_image_2.1_vae_bf16.safetensors` → `models/vae/`(约 17 GB,<https://huggingface.co/Comfy-Org/Qwen-Image-2.1>,ComfyUI v0.37+)
