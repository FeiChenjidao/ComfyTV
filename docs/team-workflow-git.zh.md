# 团队工作流：公开 Git 同步（原生画布）

局域网内希望 **自己的完整工作流** 能上传、同事能看到并打开时，用独立公开 Git 仓作为：

```text
ComfyUI/user/default/workflows/
```

底部工具栏的「工作流」列的就是这份原生库，**不是** Stage 节点下拉里的 `user/comfytv/workflows`。

完整约定、接入步骤、脚本与验证清单：

[`team-workflows/README.md`](../team-workflows/README.md)

快速流程：

同事**只更新 ComfyTV 插件**时：

1. 插件内 `secrets/comfytv-git-token` + `secrets/comfytv-git-remote` 会在打开工作流面板时自动写到 `user/default/workflows/.comfytv-git-*`（已有文件不覆盖）。
2. 本机还没有独立 `.git` 时，底部栏点 **「连接团队仓」** 一键 clone；之后用「更新 / 提交」。

1. 把 `team-workflows/` 推成团队公开仓
2. 各机 `git clone` → `ComfyUI/user/default/workflows`
3. 上传：`scripts/push-workflows.ps1` → 同事：`scripts/pull-and-hint.ps1` → 底部栏「工作流」刷新打开
