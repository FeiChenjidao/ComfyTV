# 团队工作流：公开 Git 同步

局域网内希望底部工具栏 / 阶段 workflow 下拉 **大家都能上传、别人能看到更新** 时，推荐用 **独立公开 Git 仓** 作为 `user/comfytv/workflows`，成本最低。

完整约定、接入步骤、脚本与验证清单见插件内模板：

[`team-workflows/README.md`](../team-workflows/README.md)

快速流程：

1. 把 `team-workflows/` 推成团队公开仓（或按 README 初始化）
2. 各机 `git clone` 到 `ComfyUI/user/comfytv/workflows`
3. 上传：`scripts/push-workflows.ps1` → 同事：`scripts/pull-and-hint.ps1` → 侧栏 **重新扫描**

相关：自定义工作流其它接入方式见 [custom-workflows.zh.md](custom-workflows.zh.md)。
