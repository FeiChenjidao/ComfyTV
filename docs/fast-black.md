# 快速去黑 / Quick Black to Alpha

Search for **快速去黑** in ComfyUI. Connect one ComfyTV video or image output. This utility keeps the existing `VideoBlackToAlphaVP8` node ID so standalone-plugin workflows can be reused. The utility runs through ComfyUI's queue and node Run button.

The embedded preview uses WebGL2 with a Canvas 2D fallback. Parameter drags update the browser preview without decoding frames on the server. Click the checkerboard icon at the preview's top right to switch dark/light backgrounds. Hover over parameter names for instructions. The reset icon at the bottom left restores processing defaults.

- **去黑阈值** identifies dark pixels globally. Start low to retain leaf detail.
- **外圈去黑边（像素）** clears eligible dark rims from the outside transparent background inward. It does not start from an enclosed dark region or the foreground's inside edge.
- **外圈柔和（像素）** softens the resulting alpha boundary.
- Optional **遮罩蒙版 / MASK**: white protects the image from keying and recoloring; black permits processing; gray provides partial protection. An opaque black/white image connected through `ComfyTV.BridgeFromMask` is read by grayscale. Transparent mask images use inverse alpha. The source must be resolvable before preview; arbitrary generated masks are consumed by export as tensors.
- **改色** enables a color picker, HEX field, and eyedropper for residual visible black. **应用到全部黑色** includes visually dark purple/red pixels outside the protection mask. Alpha stays unchanged. This can also alter unprotected dark foreground details.
- **预览帧** is zero-based and only chooses the preview frame. It does not trim the export. **CRF** controls export compression, not the uncompressed preview.

Video export produces a silent, transparent **VP8 WebM**, using the source average frame rate and duration (within one output frame of rounding). Image export produces one second at 24 fps. Odd dimensions receive one transparent pixel at the right/bottom for VP8. Preview and export share RGB adjustment and alpha algorithms; VP8's lossy compression and 4:2:0 chroma sampling can introduce small differences. Use the same frame and background when comparing.

## Installation and migration

Install ComfyTV's Python dependencies, including SciPy. Install an FFmpeg build supporting `libvpx`, `ffv1`, and alpha, with both `ffmpeg` and `ffprobe` on `PATH`. Alternatively set **COMFYTV_FFMPEG** and, if needed, **COMFYTV_FFPROBE** to their executable paths. No developer-machine paths are shipped. These executable names work on Windows, macOS, and Linux.

If upgrading from `ComfyUI-VideoBlackToAlpha`, disable/remove the standalone custom-node package before restarting ComfyUI: both packages register the same node ID. Keep existing workflows; reconnect sockets if needed. Fully restart the backend, then hard-refresh the page. Version mismatch text means the front end and backend are from different revisions.

The HTTP helpers live under `/comfytv/fast_black_*`, separate from the standalone plugin. They accept local ComfyUI media URLs and enforce directory containment. The compatibility PNG preview endpoint remains available, but slider changes use browser rendering.

An example workflow is included in [fast-black-example.json](fast-black-example.json).
