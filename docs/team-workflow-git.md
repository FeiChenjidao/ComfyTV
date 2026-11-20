# Team workflows: public Git sync (native canvases)

[简体中文](team-workflow-git.zh.md) | **English**

Publish **full ComfyUI graphs** as team templates via a public Git repo cloned as:

```text
ComfyUI/custom_nodes/ComfyTV/example_workflows/
```

This is the plugin template library. `user/<id>/workflows` remains exclusively for each user's own workflows.

Full guide: [`team-workflows/README.md`](../team-workflows/README.md)

1. Push `team-workflows/` as the team public repo  
2. Each machine: click **Connect team repo** to clone into `ComfyTV/example_workflows`
3. Publish with `scripts/push-workflows.ps1`; colleagues `pull-and-hint.ps1`, then open **Workflows** on the bottom bar  
