# ComfyTV 团队共享工作流（公开 Git）

用 **公开 Git 仓库** 同步局域网内同事的 **完整画布工作流**（ComfyUI 原生库），不是 Stage 节点下拉里那套插件管线。

上传走 `git push`，别人 `git pull` 后，在 **底部工具栏 → 工作流**（或 ComfyUI Workflows 面板）即可打开。

本目录是可直接推到 GitHub / Gitee 的仓模板。正式使用时：把它作为 **独立仓库** clone 到：

```text
ComfyUI/user/default/workflows/
```

该目录里必须有自己的 `.git`（`git rev-parse --show-toplevel` 应等于该路径）。  
若没有独立 `.git`，Git 会误用上层整仓 ComfyUI，出现「全局 pull / diverging branches」——底部栏会判定为「未配置 Git」。

**不要** clone 到 `user/comfytv/workflows/`——那是各 Stage（Image / Video …）用的绑定库。  
**不要**把 remote 指到整仓 ComfyUI / jihulab 的 ComfyUI 镜像。

## 和 Stage 库的区别

| | 本仓（原生 / 底部栏） | Stage 库 |
|--|--|--|
| 路径 | `user/default/workflows/` | `user/comfytv/workflows/<kind>/` |
| 用途 | 完整画布图，打开后整图编辑 | 某个 Stage 节点选管线 |
| 底部栏 | 工作流按钮列这里 | 不在此列 |

## 目录约定

```text
comfytv-team-workflows/     ← 本仓根 = 各机的 user/default/workflows
  README.md
  .gitignore
  scripts/
    pull-and-hint.ps1
    push-workflows.ps1
  team/                     ← 建议：团队共享子目录（底部栏显示文件夹徽章）
    brand-look.json
  my-draft.json             ← 也可放在根目录
```

规则：

- 只同步 **GUI 格式**工作流 JSON（ComfyUI *Workflow → Save*，不要 API Format）
- 不同步模型权重；勿提交 API Key
- 文件名保持稳定；冲突先 `pull` 再改，或走 PR
- 可用子文件夹分类（如 `team/`、`ads/`），底部栏会显示文件夹名

## 各机一次性接入

1. 备份已有库（若有）：  
   `ComfyUI/user/default/workflows` → 例如 `workflows.bak`
2. Clone 团队公开仓到该路径：

   ```powershell
   cd ComfyUI\user\default
   # 若 workflows 已存在且非空，先改名备份
   git clone https://github.com/<org>/comfytv-team-workflows.git workflows
   ```

3. 打开 ComfyUI → 点底部栏 **工作流**，应看到仓内 JSON（点名称即可打开画布）

首次把本模板推成公开仓：

```powershell
cd path\to\team-workflows
git init
git add .
git commit -m "chore: init shared native workflows"
git branch -M main
git remote add origin https://github.com/<org>/comfytv-team-workflows.git
git push -u origin main
```

## 日常协作

### 发布

1. 在 ComfyUI 里做好图 → *Workflow → Save* 到 `user/default/workflows/`（建议 `team/` 下）
2. 运行：

   ```powershell
   cd ComfyUI\user\default\workflows
   .\scripts\push-workflows.ps1 -Message "feat: add brand look"
   ```

### 拉取

```powershell
cd ComfyUI\user\default\workflows
.\scripts\pull-and-hint.ps1
```

然后打开底部栏 **工作流**（关闭再开即可刷新列表）。无需 ComfyTV「重新扫描」——那是 Stage 库用的。

## 验证清单

1. **甲** 在 `team/` 放入 `demo.json`，执行 `push-workflows.ps1`
2. **乙** 执行 `pull-and-hint.ps1` → 打开底部栏「工作流」
3. 乙看到 `demo`，徽章为 `team`，点击后画布打开该图
4. 甲改 JSON 再 push → 乙再 pull → 重新打开可见更新

## 脚本说明

| 脚本 | 作用 |
|------|------|
| `scripts/pull-and-hint.ps1` | `git pull`，并提示刷新底部栏工作流面板 |
| `scripts/push-workflows.ps1` | `git add` → commit（可传 `-Message`）→ push |

可选参数 `-RepoRoot` 指向非默认的仓根路径。

## 不在本方案内

- Stage 节点下拉（`user/comfytv/workflows`）同步
- 应用内自动 pull / 冲突 UI
- 模型权重分发
- 画布共同编辑（`enable-collab`）
