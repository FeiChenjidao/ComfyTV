# Team workflow Git credentials (local only)

**Do not commit `comfytv-git-token`.** GitHub secret scanning will revoke the PAT.

## How colleagues get a token

1. Admin sends the PAT out-of-band (chat / 内网).
2. In ComfyTV → **Settings → 团队工作流 Git**，paste and save  
   **or** when clicking **提交工作流**, fill the popup if none is configured.
3. Token is stored only as:

`ComfyUI/user/<id>/workflows/.comfytv-git-token`

| Optional local plugin file | Installed as (if missing) |
|--|--|
| `comfytv-git-token` (gitignored) | `.comfytv-git-token` |
| `comfytv-git-remote` (safe to commit) | `.comfytv-git-remote` |

Existing `.comfytv-git-*` files are **not** overwritten on seed.
