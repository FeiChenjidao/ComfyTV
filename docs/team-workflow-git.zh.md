# 团队工作流：公开 Git 同步（原生画布）

局域网内希望 **自己的完整工作流** 能发布为团队模板时，独立 Git 仓由 ComfyTV 克隆到：

```text
ComfyUI/custom_nodes/ComfyTV/example_workflows/
```

这里是插件模板库；`user/<账号>/workflows` 只保存用户自己的工作流，两者不会互相覆盖。

完整约定、接入步骤、脚本与验证清单：

[`team-workflows/README.md`](../team-workflows/README.md)

快速流程：

同事**只更新 ComfyTV 插件**时：

1. 插件内 `secrets/comfytv-git-token` + `secrets/comfytv-git-remote` 会在打开工作流面板时自动写到 `example_workflows/.comfytv-git-*`（已有文件不覆盖）。
2. 本机还没有独立 `.git` 时，底部栏点 **「连接团队仓」** 一键 clone；之后用「更新 / 提交」。

1. 把 `team-workflows/` 推成团队公开仓
2. 各机在底部栏点「连接团队仓」，自动 clone 到 `ComfyTV/example_workflows`
3. 上传：`scripts/push-workflows.ps1` → 同事：`scripts/pull-and-hint.ps1` → 底部栏「工作流」刷新打开
