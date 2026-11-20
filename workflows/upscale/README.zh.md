[English](README.md) | **简体中文**

# `upscale/` 工作流

这个目录下的工作流出现在 **Upscale** 下拉框。连接一张上游图,产出高分辨率版本。

## stage 提供的输入

- **源图**(必需) , 来自上游。
- **倍数**(`2x` / `4x`) , 在线工作流会映射到对应目标分辨率或 scale factor。
- **提示词**(可选) , 创意放大工作流会消费。

## 工作流需要包含

- 一个 `SaveImage` 输出节点(自动检测)。
- 一个 `LoadImage` 接源图。
- 一个在线放大节点,或自定义的本地 upscaler 链。

加自己的工作流见 [docs/custom-workflows.zh.md](../../docs/custom-workflows.zh.md);具体绑定在画布上选中 stage 后通过左侧 **ComfyTV** 侧边栏配,详见 [docs/sidebar-config-editor.zh.md](../../docs/sidebar-config-editor.zh.md)。

## 当前内置

- **WaveSpeed（省钱超分）** , 默认。在线快速超分。
- **Magnific 图像放大（精确 V2）**、**Magnific 图像放大（创意）** , 在线精确/创意放大。

Ultrasharp 工作流及其 `4x-UltraSharp.pth` 依赖已删除。

