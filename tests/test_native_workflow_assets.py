from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def restore_import_stubs():
    names = ["folder_paths", "ComfyTV.api", "ComfyTV.runners", "ComfyTV.runners._workflow_resolve", "ComfyTV.api.native_workflow_assets"]
    previous = {name: sys.modules.get(name) for name in names}
    attributes = {name: dict(module.__dict__) for name, module in previous.items() if module is not None}
    yield
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
            module.__dict__.clear()
            module.__dict__.update(attributes[name])


def _load_assets_mod(tmp_path: Path):
    root = Path(__file__).resolve().parents[1]
    pkg = "ComfyTV"
    if pkg not in sys.modules:
        m = types.ModuleType(pkg)
        m.__path__ = [str(root)]
        sys.modules[pkg] = m
    for name in ("ComfyTV.api", "ComfyTV.runners", "ComfyTV.runners._workflow_resolve"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["ComfyTV.runners"].__path__ = [str(root / "runners")]

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


def test_scans_editor_captures_properties_descriptors_and_subgraphs(tmp_path):
    mod, *_ = _load_assets_mod(tmp_path)
    doc = {
        "nodes": [{
            "type": "ComfyTV.CanvasStage",
            "widgets_values": ["/view?filename=capture.png&type=input", json.dumps({"root": {"children": [{"url": "/view?filename=layer.png&type=input"}]}})],
            "properties": {
                "comfytv_split_overrides": {"/view?filename=source.png&type=input": "/view?filename=edit.png&type=input"},
                "comfytv_layer_separation_compositor": {"compositor_layers": [{"filename": "piece.png", "subfolder": "layers", "type": "output"}]},
            },
        }],
        "definitions": {"subgraphs": [{"nodes": [{"type": "ComfyTV.VideoLoaderStage", "widgets_values": ["default", 0, "clip.mp4"]}]}]},
    }
    refs = mod.scan_workflow_media(doc)
    for name in ("capture.png", "layer.png", "source.png", "edit.png", "piece.png", "clip.mp4"):
        assert any(name in ref for ref in refs)
    assert not any(ref == "piece.png" for ref in refs)
    assert any("subfolder=layers" in ref and "type=output" in ref for ref in refs)


def test_model_history_does_not_pack_large_model_artifacts(tmp_path):
    mod, *_ = _load_assets_mod(tmp_path)
    refs = mod.scan_workflow_media({"nodes": [{"type": "ComfyTV.Model3DStage", "widgets_values": [json.dumps({"images": [{"image_url": "/view?filename=model.glb&type=output"}]})]}]})
    assert refs == []


def test_editor_assets_pack_and_restore_with_their_original_folders(tmp_path):
    mod, input_dir, output_dir, _ = _load_assets_mod(tmp_path)
    (input_dir / "edit.png").write_bytes(b"edited-layer")
    (output_dir / "layers").mkdir()
    (output_dir / "layers" / "piece.png").write_bytes(b"compositor-layer")
    root = tmp_path / "templates"
    root.mkdir()
    doc = {"nodes": [{"type": "ComfyTV.LayerSeparationStage", "widgets_values": ["/view?filename=edit.png&type=input"],
                      "properties": {"compositor": {"compositor_layers": [{"filename": "piece.png", "subfolder": "layers", "type": "output"}]}}}]}
    (root / "editor.json").write_text(json.dumps(doc), encoding="utf-8")
    packed = mod.pack_for_workflows(root, ["editor.json"])
    assert packed.packed_files == 2
    assert packed.warnings == []
    import folder_paths
    fresh = tmp_path / "fresh"
    folder_paths.get_input_directory = lambda: str(fresh / "input")
    folder_paths.get_output_directory = lambda: str(fresh / "output")
    restored = mod.restore_assets(root)
    assert restored.restored == 2
    assert (fresh / "input" / "edit.png").read_bytes() == b"edited-layer"
    assert (fresh / "output" / "layers" / "piece.png").read_bytes() == b"compositor-layer"
