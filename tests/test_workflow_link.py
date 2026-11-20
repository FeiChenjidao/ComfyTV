from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from ComfyTV.runners import workflow_db as wdb


GUI = json.dumps({"nodes": [{"id": 1, "type": "X"}], "groups": []})
API = json.dumps({"3": {"class_type": "KSampler", "inputs": {}}})


@pytest.fixture()
def native_dir(tmp_path, monkeypatch):
    d = tmp_path / "native" / "workflows"
    d.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(wdb.link, "_native_workflows_dir", lambda *_a, **_k: d)
    monkeypatch.setattr(wdb.link, "_template_workflows_dir", lambda: d)
    return d


class TestInstantiateNativeWorkflowTemplate:
    def test_prepares_distinct_unsaved_local_workflow(self, native_dir):
        source_data = {
            "id": "template-id",
            "revision": 12,
            "nodes": [{"id": 1, "type": "X"}],
            "groups": [],
        }
        source = native_dir / "embroidery.json"
        source.write_text(json.dumps(source_data), encoding="utf-8")

        result = wdb.instantiate_native_workflow_template("embroidery.json")

        assert result["path"] == "_local/embroidery.json"
        assert not (native_dir / result["path"]).exists()
        assert result["graph"]["id"] != source_data["id"]
        assert result["graph"]["revision"] == 0
        assert result["graph"]["nodes"] == source_data["nodes"]
        assert json.loads(source.read_text(encoding="utf-8")) == source_data

    def test_uses_incrementing_name_without_creating_file(self, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        local = native_dir / "_local"
        local.mkdir()
        existing = local / "a.json"
        existing.write_text(GUI, encoding="utf-8")

        result = wdb.instantiate_native_workflow_template("a.json")

        assert result["path"] == "_local/a 2.json"
        assert not (native_dir / result["path"]).exists()
        assert existing.read_text(encoding="utf-8") == GUI

    def test_rejects_non_gui_workflow(self, native_dir):
        (native_dir / "api.json").write_text(API, encoding="utf-8")
        with pytest.raises(ValueError, match="GUI-format"):
            wdb.instantiate_native_workflow_template("api.json")

    def test_rejects_path_traversal(self, native_dir, tmp_path):
        (tmp_path / "outside.json").write_text(GUI, encoding="utf-8")
        with pytest.raises(ValueError, match="outside"):
            wdb.instantiate_native_workflow_template("../../outside.json")


class TestLinkWorkflow:
    def test_link_creates_linked_row(self, reset_db, native_dir):
        from ComfyTV import db
        (native_dir / "my_flow.json").write_text(GUI, encoding="utf-8")
        res = wdb.link_workflow("image", "my_flow.json")
        assert res["link_type"] == db.LINK_TYPE_NATIVE
        assert res["label"] == "my_flow"

        rows = [r for r in wdb.list_workflows() if r["kind"] == "image"]
        row = next(r for r in rows if r["label"] == "my_flow")
        assert row["link_type"] == db.LINK_TYPE_NATIVE

    def test_link_points_at_native_file_path(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        wdb.link_workflow("video", "a.json")
        pair = wdb.read_workflow_file("video", "a")
        assert pair is not None
        content, _ = pair
        assert json.loads(content) == json.loads(GUI)

    def test_link_custom_label(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        res = wdb.link_workflow("image", "a.json", label="Fancy Name")
        assert res["label"] == "Fancy Name"

    def test_link_rejects_non_gui(self, reset_db, native_dir):
        (native_dir / "bad.json").write_text(API, encoding="utf-8")
        with pytest.raises(ValueError):
            wdb.link_workflow("image", "bad.json")

    def test_link_rejects_missing_file(self, reset_db, native_dir):
        with pytest.raises(ValueError):
            wdb.link_workflow("image", "nope.json")

    def test_link_rejects_path_traversal(self, reset_db, native_dir, tmp_path):
        outside = tmp_path / "secret.json"
        outside.write_text(GUI, encoding="utf-8")
        with pytest.raises(ValueError):
            wdb.link_workflow("image", "../secret.json")

    def test_link_duplicate_label_raises(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        (native_dir / "b.json").write_text(GUI, encoding="utf-8")
        wdb.link_workflow("image", "a.json", label="Same")
        with pytest.raises(ValueError):
            wdb.link_workflow("image", "b.json", label="Same")

    def test_link_same_file_twice_raises(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        wdb.link_workflow("image", "a.json", label="One")
        with pytest.raises(ValueError):
            wdb.link_workflow("image", "a.json", label="Two")

    def test_same_file_different_kinds_ok(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        wdb.link_workflow("image", "a.json")
        wdb.link_workflow("video", "a.json")
        labels = {(r["kind"], r["label"]) for r in wdb.list_workflows()}
        assert ("image", "a") in labels and ("video", "a") in labels


class TestUnlinkWorkflow:
    def test_unlink_removes_row_keeps_file(self, reset_db, native_dir):
        f = native_dir / "a.json"
        f.write_text(GUI, encoding="utf-8")
        res = wdb.link_workflow("image", "a.json")
        wid = res["id"]
        out = wdb.unlink_workflow(wid)
        assert out and out["ok"]
        assert f.exists()
        assert not any(r["label"] == "a" for r in wdb.list_workflows())

    def test_unlink_missing_returns_none(self, reset_db, native_dir):
        assert wdb.unlink_workflow(999999) is None

    def test_unlink_managed_raises(self, reset_db, tmp_path, monkeypatch):
        wdir = tmp_path / "workflows"
        (wdir / "image").mkdir(parents=True)
        monkeypatch.setattr(wdb.seed, "_WORKFLOWS_DIR", wdir)
        res = wdb.import_workflow("image", "managed.json", GUI)
        from ComfyTV import db
        with db.get_session() as s:
            from sqlalchemy import select
            row = s.execute(
                select(db.Workflow).where(db.Workflow.label == res["label"])
            ).scalar_one()
            wid = row.id
        with pytest.raises(ValueError):
            wdb.unlink_workflow(wid)


class TestListNativeWorkflows:
    def test_lists_and_flags_linked(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        (native_dir / "b.json").write_text(GUI, encoding="utf-8")
        (native_dir / "a_preset.json").write_text("{}", encoding="utf-8")
        wdb.link_workflow("image", "a.json")

        items = wdb.list_native_workflows()
        by_name = {it["name"]: it for it in items}
        assert "a" in by_name and "b" in by_name
        assert "a_preset" not in by_name
        assert by_name["a"]["is_linked"] is True
        assert by_name["b"]["is_linked"] is False

    def test_skips_dotfiles_like_core_glob(self, reset_db, native_dir):
        (native_dir / "a.json").write_text(GUI, encoding="utf-8")
        (native_dir / ".index.json").write_text(
            json.dumps({"favorites": ["workflows/a.json"]}), encoding="utf-8"
        )
        hidden = native_dir / ".trash"
        hidden.mkdir()
        (hidden / "old.json").write_text(GUI, encoding="utf-8")

        items = wdb.list_native_workflows()
        paths = {it["path"] for it in items}
        assert paths == {"a.json"}

    def test_lists_nested_paths(self, reset_db, native_dir):
        sub = native_dir / "folder" / "sub"
        sub.mkdir(parents=True)
        (sub / "deep.json").write_text(GUI, encoding="utf-8")

        items = wdb.list_native_workflows()
        assert {it["path"] for it in items} == {"folder/sub/deep.json"}


class TestLinkedMtimeSync:
    def test_native_edit_invalidates_api_json(self, reset_db, native_dir):
        f = native_dir / "a.json"
        f.write_text(GUI, encoding="utf-8")
        wdb.link_workflow("image", "a.json")

        assert wdb.set_api_json(
            "image", "a", {"1": {"class_type": "X", "inputs": {}}}, f.stat().st_mtime
        )
        st = wdb.get_workflow_state("image", "a")
        assert st and st["has_api"] is True

        time.sleep(0.01)
        new = json.dumps({"nodes": [{"id": 1, "type": "X"}, {"id": 2, "type": "Y"}]})
        f.write_text(new, encoding="utf-8")
        os.utime(f, (f.stat().st_atime, f.stat().st_mtime + 5))

        st2 = wdb.get_workflow_state("image", "a")
        assert st2 and st2["has_api"] is False


class TestUnlinkClearsDefault:
    def test_unlinked_default_falls_back(self, reset_db, native_dir):
        (native_dir / "fav.json").write_text(GUI, encoding="utf-8")
        res = wdb.link_workflow("image", "fav.json")
        wdb.set_default_workflow(res["id"], True)
        assert wdb.get_default_label("image") == "fav"

        wdb.unlink_workflow(res["id"])
        assert wdb.get_default_label("image") is None


class TestNativeRepointOnUserDirMove:
    def test_native_rows_follow_user_dir(self, reset_db, native_dir, tmp_path, monkeypatch):
        from ComfyTV import db
        (native_dir / "fav.json").write_text(GUI, encoding="utf-8")
        old = tmp_path / "old-user" / "default" / "workflows"
        old.mkdir(parents=True)
        (old / "fav.json").write_text(GUI, encoding="utf-8")
        with db.get_session() as s:
            s.add(db.Workflow(kind="image", label="fav",
                              file_path=str(old / "fav.json"),
                              link_type=db.LINK_TYPE_NATIVE))
            s.commit()

        wroot = tmp_path / "wroot"
        wroot.mkdir()
        monkeypatch.setattr(wdb.seed, "_WORKFLOWS_DIR", wroot)
        wdb.seed_workflows_from_disk(("image",))

        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert str(native_dir) in rows[0]["file_path"]
        assert rows[0]["link_type"] == db.LINK_TYPE_NATIVE

    def test_native_row_untouched_when_new_copy_missing(self, reset_db, native_dir, tmp_path, monkeypatch):
        from ComfyTV import db
        old = tmp_path / "old-user" / "default" / "workflows"
        old.mkdir(parents=True)
        (old / "keep.json").write_text(GUI, encoding="utf-8")
        with db.get_session() as s:
            s.add(db.Workflow(kind="image", label="keep",
                              file_path=str(old / "keep.json"),
                              link_type=db.LINK_TYPE_NATIVE))
            s.commit()

        wroot = tmp_path / "wroot"
        wroot.mkdir()
        monkeypatch.setattr(wdb.seed, "_WORKFLOWS_DIR", wroot)
        wdb.seed_workflows_from_disk(("image",))

        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert str(old) in rows[0]["file_path"]
