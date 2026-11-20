[English](README.md) | **简体中文**

# `cutout/` 工作流

这个目录下的工作流出现在 **Cutout** 下拉框。连接一张上游图,返回主体被分割出来、背景替换为透明 alpha 通道的同一张图。

## stage 提供的输入

- **源图**(必需) , 来自上游。没有提示词,没有可调 widget。

## 工作流需要包含

- 一个 `SaveImage` 输出节点(自动检测)。
- 一个 `LoadImage` 接源图。
- 一个背景去除节点。在线 Bria 节点直接输出带 alpha 的 `IMAGE`;分割链也可以用 `JoinImageWithAlpha` 合成透明 PNG。

加自己的工作流见 [docs/custom-workflows.zh.md](../../docs/custom-workflows.zh.md);具体绑定在画布上选中 stage 后通过左侧 **ComfyTV** 侧边栏配,详见 [docs/sidebar-config-editor.zh.md](../../docs/sidebar-config-editor.zh.md)。

## 当前内置

- **Online Bria Cutout**(`birefnet-cutout.json` + `_preset.json`) , 默认。`LoadImage → BriaRemoveImageBackground → SaveImage`,无需本地模型,会消耗 Comfy API credits。

## 本地模型

当前不需要。原 BiRefNet 和 Qwen Image 2.1 抠图工作流已由在线 Bria 替代。
