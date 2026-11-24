# 3D 重拓扑（Tripo）

连接 **3D 模型阶段** 的 `model` 输出到本节点的 `model` 输入，设置参数后点击运行。节点会先用原生 **Tripo: Import Model** 导入模型，再执行 **Tripo: Retopology**，结果可以预览、下载，或连接到后续 3D 节点。

- **目标面数**：`-1` 自动决定；三角面支持 `500–20,000`，四边面支持 `500–10,000`。
- **四边面**：关闭时输出 GLB；开启时输出 FBX，直接保存服务返回的文件以保留四边面拓扑。
- **烘焙贴图**：默认开启，将原模型贴图烘焙到新网格。

输入支持 GLB、FBX、OBJ、STL，不限于 Tripo 生成的模型；建议使用包含内嵌贴图的 GLB。GLTF、点云及高斯泼溅需要先转换成支持的网格格式。Tripo 导入限制为 150 MB。

这是使用 Comfy.org 登录账户的 **Tripo 付费服务**。需要当前 ComfyUI 提供 `TripoImportModelNode` 和 `TripoRetopologyNode`；缺少时更新 ComfyUI。无需手动填写任务 ID，也无需绑定额外工作流。
