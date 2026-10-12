# Team workflows: public Git sync

[简体中文](team-workflow-git.zh.md) | **English**

To keep the ComfyTV bottom-bar / stage workflow dropdown in sync on a LAN—anyone uploads, others see updates—use a **dedicated public Git repo** as `user/comfytv/workflows`. Lowest cost; no in-app Git UI.

Full conventions, setup, scripts, and a verification checklist:

[`team-workflows/README.md`](../team-workflows/README.md)

Quick path:

1. Push `team-workflows/` as your team’s public repo (or init per the README)
2. Each machine: `git clone` → `ComfyUI/user/comfytv/workflows`
3. Publish: `scripts/push-workflows.ps1` → colleagues: `scripts/pull-and-hint.ps1` → sidebar **Rescan**

Other ways to add workflows: [custom-workflows.md](custom-workflows.md).
