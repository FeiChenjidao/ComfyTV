# Team workflows: public Git sync (native canvases)

[简体中文](team-workflow-git.zh.md) | **English**

Share **full ComfyUI graphs** on a LAN via a public Git repo cloned as:

```text
ComfyUI/user/default/workflows/
```

The bottom-bar **Workflows** panel lists this native library — not ComfyTV stage dropdowns under `user/comfytv/workflows`.

Full guide: [`team-workflows/README.md`](../team-workflows/README.md)

1. Push `team-workflows/` as the team public repo  
2. Each machine: `git clone` → `user/default/workflows`  
3. Publish with `scripts/push-workflows.ps1`; colleagues `pull-and-hint.ps1`, then open **Workflows** on the bottom bar  
