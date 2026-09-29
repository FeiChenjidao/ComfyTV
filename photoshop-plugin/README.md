# ComfyTV Photoshop 2020/2021 Panel

This is a CEP extension for Photoshop 2020 (21.x) and Photoshop 2021 (22.x).
It connects only to a local ComfyUI server. `Send selected layer` exports the
active layer as a transparent PNG. ComfyTV updates the selected `Load Image`
node, reuses the previous Photoshop target, or creates a loader when needed.
When the document has an active selection, only the selected pixels from the
active layer are exported. Multiple selected layers are not merged.

PNG layers up to 256 MB are accepted. ComfyUI must also be started with an
upload limit of at least 512 MB, for example `--max-upload-size 512`.

## Install on Windows

1. Copy the `photoshop-plugin` directory to
   `%APPDATA%\Adobe\CEP\extensions\comfytv`.
2. Enable unsigned CEP extensions by setting the string value `PlayerDebugMode`
   to `1` under both `HKEY_CURRENT_USER\Software\Adobe\CSXS.9` and
   `HKEY_CURRENT_USER\Software\Adobe\CSXS.10`.
3. Restart Photoshop and open `Window > Extensions > ComfyTV`. Some Photoshop
   2021 builds list it under `Window > Extensions (Legacy)`.
4. Start ComfyUI, click `Connect`, then click `Send selected layer`.

When the ComfyTV panel has focus, `Ctrl + Shift + Enter` sends the selected
layer too. The shortcut is ignored while typing in the server address field.

The panel intentionally does not embed the complete ComfyTV interface. The
Chromium versions bundled with Photoshop 2020 and 2021 cannot reliably run the
current ComfyTV frontend.
