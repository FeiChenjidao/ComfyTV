# 图层分离工作流

把 `*_preset.json`（及对应 API/GUI JSON）放在此目录。工作流结果应为
**分层 PSD/PSB**（或图片批次）。

在 ComfyTV 工作流配置里，将 **结果输出类型** 设为 **分层图像**
（`ui_save_layered`），并把结果节点指到对应的保存节点。
