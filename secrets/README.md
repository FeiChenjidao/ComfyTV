# Team workflow Git credentials (plugin-bundled)

On ComfyTV load / git status / 「连接团队仓」, the plugin copies these into:

`ComfyUI/user/default/workflows/`

| Plugin file | Installed as |
|--|--|
| `comfytv-git-token` | `.comfytv-git-token` |
| `comfytv-git-remote` | `.comfytv-git-remote` |

Existing files on disk are **not** overwritten.

Colleagues who **only update the plugin** get push/pull auth without copying the whole ComfyUI tree.

Rotate the PAT in GitHub when leaking is a concern; replace `comfytv-git-token` and ship a new plugin build.
