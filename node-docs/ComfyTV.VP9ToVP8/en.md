# VP9 to VP8 Alpha

Convert a VP9 WebM video directly to a VP8 WebM video while preserving its alpha channel.

## Inputs

- `video`: A VP9 `COMFYTV_VIDEO` input.
- `quality`: `draft`, `standard`, or `high`. Higher quality creates a larger file.

## Output

The node outputs a VP8 WebM with `alpha_mode=1`. Resolution and frame rate are preserved. Audio is not included.

Use the download button on the node output rather than the browser video player's download command.
