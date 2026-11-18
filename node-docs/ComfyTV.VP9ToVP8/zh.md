# VP9 转 VP8 Alpha

把 VP9 WebM 视频直接转换为 VP8 WebM，并保留 Alpha 透明通道。

## 输入

- `video`：VP9 格式的 `COMFYTV_VIDEO`。
- `quality`：`draft`、`standard` 或 `high`。质量越高，文件越大。

## 输出

节点输出带 `alpha_mode=1` 的 VP8 WebM，并保持原分辨率和帧率。输出不包含音轨。

请使用节点输出区域的下载按钮，不要使用浏览器视频播放器内部的下载命令。
