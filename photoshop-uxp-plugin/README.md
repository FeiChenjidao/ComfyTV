# ComfyTV Photoshop UXP Plugin

Photoshop 2024+ panel for sending the current canvas to a ComfyUI workflow and
placing the generated result back into Photoshop as a new layer. Pixel capture
uses the Photoshop UXP Imaging API directly, so the plugin does not create a
temporary Photoshop document.

## Current features

- Full-panel source/result preview with contain and cover modes.
- Positive and negative prompts, seed, and random seed. There is no denoise or redraw-strength control.
- Uses the active selection as the crop and mask when one exists.
- Settings `更大则缩小` and `更小则放大` resize the captured canvas before it is sent. Images that already sit inside those limits, and inside the hard generation cap, keep their original pixels.
- Up to six local reference images are sent with the canvas and wired into the NanoBanana, Pro, and GPT image inputs.
- Render queues the open ComfyUI graph. Click the button again while a job is running to interrupt it. A count above 1 generates one image after another.
- Receives the rendered image over the WebSocket and places it into the captured document area as a new smart layer.
- Sends every selected layer to `ComfyTV.ImageLoaderStage`. The first layer updates a selected loader; further layers each create a loader.
- Panel-focused render shortcut: `Ctrl+Shift+Enter`.

## Development install

Load this directory with Adobe UXP Developer Tool while Photoshop is running:

```text
D:\ComfyUI\ComfyUI\custom_nodes\ComfyTV\photoshop-uxp-plugin
```

Photoshop's registered production folder is a Junction to this source folder:

```text
C:\Users\Administrator\AppData\Roaming\Adobe\UXP\Plugins\External\com.comfytv.photoshop.uxp_0.3.1
```

Open `Plugins > ComfyTV`, start ComfyUI, and load the Photoshop workflow. Render
queues that graph through `/ps/ws`. `Send current layer to ComfyTV` uses
`/comfytv/photoshop/layer`.

The manifest permits HTTP and WebSocket access to localhost ports 8188, 8189, 8190, 8000, and 3000. UXP
does not treat `127.0.0.1` as an allow-listed domain, so a request to that IP
fails with "Manifest entry not found" before it reaches ComfyUI. Network calls
rewrite that address to `localhost` on the same port. The embedded ComfyUI panel uses the webview permission for those same local origins. It does
not request clipboard or unrestricted network access.
When using the installed production copy, manifest edits apply after Photoshop
is fully quit and reopened. During development, UDT can apply them with
`Unload` followed by `Load & Watch` without restarting Photoshop.

## Hot update

Double-click `photoshop-hot-update.cmd` in the ComfyTV folder after editing the
plugin. The script validates the source and installation Junctions, JavaScript,
Python, Adobe registration, workflow links, frontend bridge, and running server.
It does not copy files. It reports whether Comfy Desktop or Photoshop needs one
restart for backend, node-schema, manifest, or UXP host changes. The embedded
composer still polls its local revision endpoint and reloads ordinary composer
HTML, CSS, and JavaScript changes without a restart.

For changes to the UXP shell (`main.js`, `index.html`, or `styles.css`), install
Adobe UXP Developer Tool once, add this folder's `manifest.json`, and select
`Load & Watch`. Adobe reloads those files without restarting Photoshop. A
manifest change still requires `Unload` followed by `Load & Watch` in UDT.

## Panel painting (Photoshop 2024)

Verified in Photoshop 2024. The reference plugin `comfyui-photoshop` 1.9.3 draws
its icons as SVG paths. It is not an icon font and not a set of image files.
Copy that approach. Do not replace these icons with text.

What actually paints in this panel:

- One `<img>` JPEG. The full-bleed preview has to be an `<img>`, not a CSS
  background. A single extra icon JPEG also paints.
- Text.
- SVG built with `document.createElementNS` after the page loads. Each icon is
  an `<svg>` plus one `<path>` per shape, with `d`, `fill`, and `fill-rule`
  set as attributes. `paintIcons()` in `icons.js` does this. The path data and
  the sizes (rail 32, tiny and play 24, menu and spark 36) come from the
  reference plugin.

What does not paint:

- `<svg>` written in the static HTML.
- `innerHTML` on an SVG node. The reference plugin can do that only because its
  manifest sets `allowCodeGenerationFromStrings`. This plugin does not, so build
  the nodes with `createElementNS` instead.
- SVG placed inside a `<button>`. This was the failure that left every icon
  blank. The reference click targets are `<span role="button">`. Keep the icon
  controls as spans. The Render control stays a real `<button>` because the
  script sets `.disabled` on it; its play icon sits beside that button, inside
  `.render-wrap`, and is not a child of the button.
- CSS `background-image`, `<canvas>`, CSS border shapes, and absolutely
  positioned pixel spans.

What crashes Photoshop:

- Loading several icon images at once. Eight icon JPEGs alongside the preview
  crashed `Photoshop.exe` (`0xc0000005`, offset `0x5291b7`). One extra JPEG was
  fine. Do not give each icon its own image file.

Reload rule: Photoshop reads the versioned `0.3.1` Junction registered in
`%AppData%\Adobe\UXP\PluginsInfo\v1\PS.json`. Do not copy the plugin into a
second folder. Fully quit and reopen Photoshop after manifest or UXP host
changes; ordinary composer assets can use the hot-update refresh path. Open
ComfyTV → Ai Panel. The other Ai Panel is Comfyui Photoshop.
