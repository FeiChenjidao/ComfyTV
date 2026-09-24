from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def import_root(tmp_path, reset_db):
    root = tmp_path / "source"
    root.mkdir()
    return root


def _png(path: Path, color=(255, 0, 0)) -> Path:
    from PIL import Image
    Image.new("RGB", (16, 12), color).save(path)
    return path


def _import(root: Path, **options):
    from ComfyTV.api.mcp_tools.asset_import import _import_folder
    return _import_folder({"path": str(root), **options})


class TestAssetImportFolder:
    def test_imports_single_image_and_keeps_source(self, import_root):
        source = _png(import_root / "character.png")
        result = _import(import_root, category="毛绒")
        assert result["imported"] == 1
        assert result["assets"][0]["media_type"] == "image"
        assert source.is_file()
        from ComfyTV import storage
        rows = storage.list_assets(limit=10)
        assert rows[0]["name"] == "character"
        assert rows[0]["source"] == "mcp-folder"
        assert rows[0]["width"] == 16 and rows[0]["height"] == 12
        assert rows[0]["payload_url"].startswith("/view?")
        from ComfyTV.runners._media_paths import view_url_to_path
        assert view_url_to_path(rows[0]["payload_url"]).is_file()
        assert storage.list_asset_categories()[0]["name"] == "毛绒"

    def test_recursive_and_non_recursive(self, import_root):
        _png(import_root / "top.png")
        nested = import_root / "nested"
        nested.mkdir()
        _png(nested / "child.png", (0, 255, 0))
        result = _import(import_root, recursive=False)
        assert result["imported"] == 1

        result = _import(import_root, conflict="rename")
        assert result["imported"] == 2

    def test_unsupported_and_media_filter_are_reported(self, import_root):
        (import_root / "notes.txt").write_text("not media", encoding="utf-8")
        _png(import_root / "picture.png")
        result = _import(import_root, media_types=["video"])
        assert result["imported"] == 0
        assert result["skipped"] == 2
        assert any("unsupported" in error["reason"]
                   or "filtered" in error["reason"]
                   for error in result["errors"])

    def test_duplicate_content_skip_and_rename(self, import_root):
        _png(import_root / "first.png")
        first = _import(import_root)
        assert first["imported"] == 1
        second = _import(import_root)
        assert second["imported"] == 0
        assert second["duplicates"] == 1
        renamed = _import(import_root, conflict="rename")
        assert renamed["imported"] == 1
        assert renamed["assets"][0]["name"] != "first"

    def test_dry_run_does_not_write(self, import_root):
        _png(import_root / "planned.png")
        result = _import(import_root, category="planned", dry_run=True)
        assert result["imported"] == 0
        assert result["assets"][0]["asset_id"] is None
        from ComfyTV import storage
        assert storage.list_assets(limit=10) == []
        assert storage.list_asset_categories() == []

    def test_category_is_reused(self, import_root):
        from ComfyTV import storage
        category = storage.create_asset_category("shared")
        _png(import_root / "one.png")
        _png(import_root / "two.png", (0, 0, 255))
        result = _import(import_root, category="shared")
        assert result["imported"] == 2
        assert len(storage.list_asset_categories()) == 1
        rows = storage.list_assets(limit=10)
        assert all(row["category_ids"] == [category["id"]] for row in rows)

    def test_corrupt_media_does_not_block_batch(self, import_root):
        (import_root / "broken.png").write_bytes(b"not a png")
        _png(import_root / "valid.png")
        result = _import(import_root)
        assert result["imported"] == 1
        assert result["failed"] == 1
        assert result["assets"][0]["name"] == "valid"

    @pytest.mark.parametrize("path_factory", [
        lambda root: root / "missing",
        lambda root: root / "file.png",
        lambda root: root / ".." / root.name,
    ])
    def test_invalid_paths_rejected(self, import_root, path_factory):
        path = path_factory(import_root)
        if path.name == "file.png":
            path.write_bytes(b"x")
        with pytest.raises(ValueError):
            _import(path)

    def test_absolute_path_outside_previous_whitelist_is_allowed(self, import_root, tmp_path):
        outside = tmp_path / "outside"
        outside.mkdir()
        result = _import(outside)
        assert result["root"] == str(outside.resolve())
        assert result["scanned"] == 0

    def test_large_import_requires_confirmation(self, import_root):
        for index in range(51):
            (import_root / f"file-{index}.txt").write_text("skip", encoding="utf-8")
        result = _import(import_root)
        assert result["confirmation_required"] is True
        assert result["imported"] == 0
        assert len(result["plan"]) == 51

    def test_replace_is_explicitly_unsupported(self, import_root):
        with pytest.raises(ValueError, match="replace.*not supported"):
            _import(import_root, conflict="replace")

    def test_database_failure_cleans_copied_file(self, import_root, monkeypatch):
        _png(import_root / "failure.png")
        from ComfyTV import storage
        monkeypatch.setattr(storage, "create_asset", lambda **_kwargs: None)
        result = _import(import_root)
        assert result["failed"] == 1
        from ComfyTV.api.assets import media_dir
        imports = media_dir() / "imports"
        assert not imports.exists() or not list(imports.rglob("*"))
