# ComfyTV 团队工作流库（公开 Git）

用 **公开 Git 仓库** 同步局域网内同事的 ComfyTV 工作流。上传走 `git push`，别人 `git pull` 后在 ComfyTV 里 **重新扫描**，底部工具栏与阶段节点的 workflow 下拉框即可看到更新。

本目录是可直接推到 GitHub / Gitee 的仓模板。正式使用时：把它 clone 成（或替换为）本机的：

```text
ComfyUI/user/comfytv/workflows/
```

**不要**把团队文件塞进 `custom_nodes/ComfyTV/workflows/`——那是插件内置镜像源，且默认 gitignore 会忽略未登记的 JSON。

## 目录约定

```text
comfytv-team-workflows/          ← 本仓根 = 各机的 user/comfytv/workflows
  README.md
  .gitignore
  scripts/
    pull-and-hint.ps1
    push-workflows.ps1
  image/                         ← Image Stage
    my-style-t2i.json            ← GUI 格式工作流（Workflow → Save）
    my-style-t2i_preset.json     ← 绑定预设（侧栏 Export）
  video/
  image-edit/  inpaint/  erase/  outpaint/  upscale/  …
```

常见 `kind` 子目录（与 ComfyTV 阶段对应，按需新建）：

| 目录 | 用途 |
|------|------|
| `image/` | 文生图 / 图生图 |
| `image-edit/` | 图像编辑 |
| `inpaint/` `erase/` `outpaint/` `upscale/` | 修图类 |
| `video/` | 视频生成 |
| `text/` `audio/` `model/` | 文本 / 音频 / 3D |
| `multiview/` `multiangle/` `cutout/` `panorama/` | 多视角 / 抠图 / 全景 |
| `custom/` | 自定义阶段 |

规则：

- 只同步 **workflow JSON + `*_preset.json`**，不同步模型权重
- 侧栏配好绑定后点 **Export preset.json**，与工作流同名同目录提交
- 文件名保持稳定；冲突先 `pull` 再改，或走 PR
- 勿提交 API Key；各机需已安装同名模型（或路径一致）

## 各机一次性接入

1. 备份已有库（若有）：  
   `ComfyUI/user/comfytv/workflows` → 例如 `workflows.bak`
2. Clone 团队公开仓到该路径：

   ```powershell
   cd ComfyUI\user\comfytv
   # 若 workflows 已存在且非空，先改名备份
   git clone https://github.com/<org>/comfytv-team-workflows.git workflows
   ```

   Windows 也可把 clone 放在共享盘，再用 junction 指到 `user\comfytv\workflows`。
3. 打开 ComfyUI → ComfyTV 侧栏 → **阶段管理 / 工作流** → **重新扫描**
4. 底部工具栏与对应阶段的 workflow 下拉应出现仓内条目

首次把本模板推成公开仓：

```powershell
cd path\to\team-workflows   # 或已指向该模板的 clone
git init
git add .
git commit -m "chore: init team workflows library"
git branch -M main
git remote add origin https://github.com/<org>/comfytv-team-workflows.git
git push -u origin main
```

## 日常协作

### 发布（上传给同事）

1. 在本机导入 / 配好工作流，侧栏导出 `*_preset.json`
2. 确认文件在 `user/comfytv/workflows/<kind>/`
3. 运行：

   ```powershell
   cd ComfyUI\user\comfytv\workflows
   .\scripts\push-workflows.ps1 -Message "feat(image): add brand t2i"
   ```

   或手动：`git add` → `commit` → `push`（可选 PR 合并后再让大家 pull）

### 拉取（看到更新）

```powershell
cd ComfyUI\user\comfytv\workflows
.\scripts\pull-and-hint.ps1
```

然后到 ComfyTV 侧栏点 **重新扫描**。底部工具栏刷新后可见新条目。

## 验证清单

1. **甲** 在 `image/` 放入 `demo.json` + `demo_preset.json`，执行 `push-workflows.ps1`
2. **乙** 执行 `pull-and-hint.ps1` → ComfyTV **重新扫描**
3. 乙的底部工具栏与 Image Stage 下拉均出现 `demo`
4. 甲改 JSON 再 push → 乙再 pull + Rescan → 内容更新
5. 无 preset 时条目仍会出现，但绑定可能需乙本机再配一次

## 脚本说明

| 脚本 | 作用 |
|------|------|
| `scripts/pull-and-hint.ps1` | `git pull`，并提示去 ComfyTV Rescan |
| `scripts/push-workflows.ps1` | `git add` → commit（可传 `-Message`）→ push |

可选参数 `-RepoRoot` 指向非默认的仓根路径。

## 不在本方案内

- ComfyTV 应用内自动 pull / 冲突 UI
- 模型权重分发
- 与设置里「协作 / enable-collab」画布共同编辑打通（那是另一套能力）
