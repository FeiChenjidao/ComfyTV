from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path


def _load_assets_mod(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    pkg = "ComfyTV"
    if pkg not in sys.modules:
        m = types.ModuleType(pkg)
        m.__path__ = [str(root)]
        sys.modules[pkg] = m
    for name in ("ComfyTV.api", "ComfyTV.runners", "ComfyTV.runners._workflow_resolve"):
        sys.modules.setdefault(name, types.ModuleType(name))

    # Minimal /view? helper used by resolver
    resolve = sys.modules["ComfyTV.runners._workflow_resolve"]

    def _view_url_to_annotated(url: str) -> str:
        from urllib.parse import parse_qsl, urlparse, unquote
        qs = dict(parse_qsl(urlparse(url).query))
        filename = unquote(qs.get("filename", ""))
        subfolder = unquote(qs.get("subfolder", ""))
        type_ = (qs.get("type") or "input").lower()
        path = f"{subfolder}/{filename}" if subfolder else filename
        return f"{path} [{type_}]"

    resolve._view_url_to_annotated = _view_url_to_annotated

    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    temp_dir = tmp_path / "temp"
    for d in (input_dir, output_dir, temp_dir):
        d.mkdir(parents=True, exist_ok=True)

    fp = types.ModuleType("folder_paths")
    fp.get_input_directory = lambda: str(input_dir)
    fp.get_output_directory = lambda: str(output_dir)
    fp.get_temp_directory = lambda: str(temp_dir)

    def get_annotated_filepath(name: str, default_dir=None):
        text = name
        base = input_dir
        for tag, folder in (("[output]", output_dir), ("[input]", input_dir), ("[temp]", temp_dir)):
            if text.endswith(tag):
                text = text[: -len(tag)].rstrip()
                base = folder
                break
        return str(base / text)

    fp.get_annotated_filepath = get_annotated_filepath
    sys.modules["folder_paths"] = fp

    path = root / "api" / "native_workflow_assets.py"
    spec = importlib.util.spec_from_file_location(
        "ComfyTV.api.native_workflow_assets", path,
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["ComfyTV.api.native_workflow_assets"] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod, input_dir, output_dir, temp_dir


def test_scan_loadimage_and_comfytv_loaders(tmp_path):
    mod, *_ = _load_assets_mod(tmp_path)
    doc = {
        "nodes": [
            {"type": "LoadImage", "widgets_values": ["shoe.png", "image"]},
            {
                "type": "ComfyTV.ImageLoaderStage",
                "widgets_values": ["default", 0, "comfytv/uploads/a.png", ""],
            },
            {
                "type": "ComfyTV.AssetImageLoaderStage",
                "widgets_values": [
                    "default", 0,
                    "/view?filename=b.jpg&subfolder=comfytv%2Fassets&type=input",
                    1, "none", "",
                ],
            },
        ]
    }
    refs = mod.scan_workflow_media(doc)
    assert "shoe.png" in refs
    assert "comfytv/uploads/a.png" in refs
    assert any(r.startswith("/view?") for r in refs)


def test_pack_and_restore(tmp_path):
    mod, input_dir, _out, _tmp = _load_assets_mod(tmp_path)
    src = input_dir / "comfytv" / "uploads"
    src.mkdir(parents=True)
    (src / "a.png").write_bytes(b"png-bytes")

    root = tmp_path / "workflows"
    root.mkdir()
    wf = {
        "nodes": [{
            "type": "ComfyTV.ImageLoaderStage",
            "widgets_values": ["default", 0, "comfytv/uploads/a.png", ""],
        }]
    }
    (root / "demo.json").write_text(json.dumps(wf), encoding="utf-8")

    packed = mod.pack_for_workflows(root, ["demo.json"])
    assert packed.packed_files >= 1
    stored = root / "_assets" / "demo" / "input" / "comfytv" / "uploads" / "a.png"
    assert stored.is_file()

    # Point input to a fresh dir and restore
    input2 = tmp_path / "input2"
    input2.mkdir()
    import folder_paths
    folder_paths.get_input_directory = lambda: str(input2)

    restored = mod.restore_assets(root)
    assert restored.restored >= 1
    assert (input2 / "comfytv" / "uploads" / "a.png").read_bytes() == b"png-bytes"
