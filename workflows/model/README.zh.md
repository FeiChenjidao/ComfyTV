[English](README.md) | **简体中文**

# `model/` 工作流

本目录中的工作流会出现在 **3D Model Stage** 的下拉框里。输入一张上游图片（可选文本 / 模型输入），产出一个 3D 资产。Stage 的预览视口能渲染工作流保存的任何格式——网格（`.glb`、`.gltf`、`.obj` 等）、高斯泼溅（`.spz`、`.splat`、`.ksplat`、splat 型 `.ply`）和点云（`.ply`）都支持，所以 mesh、splat、点云工作流共用这一个目录。

## Stage 输入

- **提示词** — 可选；内置图生 3D 工作流都不消费它，但文生 3D 类工作流可以绑定。
- **上游图片** — 内置工作流都把 `images.image0` 提升为 3D。
- **上游文本 / 模型**（可选）— 供需要参考输入的工作流使用。
- **自定义参数** — 每个 preset 暴露的质量旋钮（见下）；未暴露的参数一律保持官方模板默认值。

## 你的工作流需要什么

- 末端一个 `SaveGLB`（或任何输出 `ui["3d"]` 结果的保存节点）——splat 管线经 `SplatToFile3D` 到达。
- 一个 `LoadImage` 承接上游图片。

自定义工作流见 [docs/custom-workflows.md](../../docs/custom-workflows.md)；逐节点绑定配置：在画布选中 stage 后打开左侧 **ComfyTV** 侧边栏，见 [docs/sidebar-config-editor.md](../../docs/sidebar-config-editor.md)。

## 当前内置

内置生成式工作流在适用处保留官方参数默认值。公共自定义参数：`seed`（未设置时每次 Run 随机）。

- **Tripo**（`tripo.json` + `_preset.json`）— 1 张图 → `TripoImageToModelNodeV2`；2–4 张（正 + 侧）→ `TripoMultiviewToModelNode`（`upstream_image:count_lt/ge[2]` 自动切换）。Stage `images.image0`…`image3` = 正 / 左 / 后 / 右。`File3DFirst` 取 GLB/FBX，Stage `quad` 开/关都可。
- **Tripo P2**（`tripo-p2.json` + `_preset.json`）— 同样自动切换（`TripoPSeriesImageToModelNode` / `TripoPSeriesMultiviewToModelNode` / P2）。参数在 `model` DynamicCombo 下；`File3DFirst` 配合 Stage `quad` 取 GLB/FBX。
- **Rodin Gen25**（`rodin-gen25.json` + `_preset.json`）— 1–5 张图 → **网格**（`Rodin3D_Gen25_Image` / Rodin Gen-2.5 图生 3D）。Stage 槽位 `images.image0`…`image4` 与 Rodin 节点入口同名一一对应；缺的参考图会 prune。绑定 `material` / `mode` / `polygon_count` / `geometry_file_format` / `texture_mode` / `seed` / `tapose` / `hd_texture` / `texture_delight` / `addon_highpack`。
- **Meshy**（`meshy-multi.json` + `_preset.json`）— 1 张图 → `MeshyImageToModelNode`；2–4 张 → `MeshyMultiImageToModelNode`（同样按数量自动切换）。`File3DFirst` 取 GLB/FBX。绑定 `seed` / `pbr` 等 Meshy 旋钮。
- **Stage 图像槽位**统一为 `images.image0`…`image4`。Rodin 用 0–4；Tripo / Meshy 用 0–3（按下标：0 正 / 1 左 / 2 背 / 3 右）。

## 引用的模型

内置工作流都是 **API**（Tripo / Rodin / Meshy）——不用下本地 3D 扩散模型。Run 前在 ComfyUI 里配好 Comfy Org API。另见 [docs/models.md](../../docs/models.md)。


