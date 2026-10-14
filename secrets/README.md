# Team workflow Git credentials (plugin-bundled)

On ComfyTV load / git status / 「连接团队仓」, the plugin copies these into:

`ComfyUI/user/default/workflows/`

| Plugin file | Installed as |
|--|--|
| `comfytv-git-token` | `.comfytv-git-token` |
| `comfytv-git-remote` | `.comfytv-git-remote` |

Existing files on disk are **not** overwritten.

`comfytv-git-token` is **bundled in this private plugin repo** so colleagues who only update ComfyTV get push/pull/commit without Git login.

Existing `.comfytv-git-*` files under each user's workflows folder are **not** overwritten on update.

Rotate the GitHub PAT if it leaks; replace `comfytv-git-token` and push a new plugin commit.
