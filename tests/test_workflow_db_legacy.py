from __future__ import annotations

import json

from ComfyTV.runners import workflow_db as wdb


class TestLegacyMigration:
    def _setup_dirs(self, tmp_path, monkeypatch):
        from pathlib import Path
        legacy = tmp_path / "legacy"
        (legacy / "image").mkdir(parents=True)
        user_root = tmp_path / "user-workflows"
        monkeypatch.setattr(wdb.seed, "_LEGACY_WORKFLOWS_DIR", Path(legacy))
        monkeypatch.setattr(wdb.seed, "_WORKFLOWS_DIR", Path(user_root))
        return legacy, user_root

    def test_sync_copies_legacy_tree_and_registers(self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "sd15.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "sd15_preset.json").write_text(json.dumps({"label": "SD 1.5"}))
        (legacy / "image" / "sd15.api.json").write_text(
            json.dumps({"3": {"class_type": "KSampler", "inputs": {}}}))

        result = wdb.seed_workflows_from_disk(("image",))

        assert sorted(result["synced"]) == [
            "image/sd15.api.json", "image/sd15.json", "image/sd15_preset.json",
        ]
        assert (user_root / "image" / "sd15.json").exists()
        assert (user_root / "image" / "sd15_preset.json").exists()
        assert (user_root / "image" / "sd15.api.json").exists()

        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert rows[0]["label"] == "SD 1.5"
        assert str(user_root) in rows[0]["file_path"]

    def test_sync_wipes_and_recopies_user_workflows(
            self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "wf.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "wf_preset.json").write_text(json.dumps({"label": "wf"}))

        r1 = wdb.seed_workflows_from_disk(("image",))
        assert set(r1["synced"]) == {"image/wf.json", "image/wf_preset.json"}

        edited = json.dumps({"nodes": [{"id": 1, "type": "UserEdit"}]})
        (user_root / "image" / "wf.json").write_text(edited)
        (user_root / "image" / "orphan.json").write_text(json.dumps({"nodes": []}))

        r2 = wdb.seed_workflows_from_disk(("image",))
        assert "image/orphan.json" in r2["removed"]
        assert not (user_root / "image" / "orphan.json").exists()
        assert (user_root / "image" / "wf.json").read_text() == json.dumps({"nodes": []})

    def test_gitignore_allowlist_skips_plugin_orphans(
            self, reset_db, tmp_path, monkeypatch):
        """Ignored leftovers under plugin workflows/ must not re-enter the mirror."""
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "keep.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "keep_preset.json").write_text(
            json.dumps({"label": "Keep"}))
        (legacy / "image" / "retired.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "retired_preset.json").write_text(
            json.dumps({"label": "Retired"}))
        (legacy / ".gitignore").write_text(
            "*.json\n"
            "!image/keep.json\n"
            "!image/keep_preset.json\n",
            encoding="utf-8",
        )

        result = wdb.seed_workflows_from_disk(("image",))
        assert set(result["synced"]) == {"image/keep.json", "image/keep_preset.json"}
        assert (user_root / "image" / "keep.json").exists()
        assert not (user_root / "image" / "retired.json").exists()
        assert not (user_root / "image" / "retired_preset.json").exists()
        assert {r["label"] for r in wdb.list_workflows_overview("image")} == {"Keep"}

    def test_existing_rows_repointed_with_state_kept(self, reset_db, tmp_path, monkeypatch):
        from ComfyTV import db
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        legacy_file = legacy / "image" / "old.json"
        legacy_file.write_text(json.dumps({"nodes": []}))

        with db.get_session() as s:
            row = db.Workflow(kind="image", label="Old",
                              file_path=str(legacy_file),
                              file_mtime=legacy_file.stat().st_mtime,
                              api_json="{}", is_default=True, order_=100)
            s.add(row)
            s.flush()
            s.add(db.WorkflowInputBinding(
                workflow_id=row.id, node_id="3", input_name="seed",
                from_="option:seed",
            ))
            s.commit()
            row_id = row.id

        wdb.seed_workflows_from_disk(("image",))

        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert rows[0]["id"] == row_id
        assert rows[0]["label"] == "Old"
        assert str(user_root) in rows[0]["file_path"]
        assert rows[0]["is_default"] is True
        cfg = wdb.get_workflow_config("image", "Old")
        assert len(cfg["bindings"]) == 1
        assert wdb.get_default_label("image") == "Old"

    def test_orphan_rows_under_either_root_are_pruned(self, reset_db, tmp_path, monkeypatch):
        from ComfyTV import db
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (user_root / "image").mkdir(parents=True)
        with db.get_session() as s:
            s.add(db.Workflow(kind="image", label="GhostLegacy",
                              file_path=str(legacy / "image" / "gone.json")))
            s.add(db.Workflow(kind="image", label="GhostUser",
                              file_path=str(user_root / "image" / "gone2.json")))
            s.commit()

        result = wdb.seed_workflows_from_disk(("image",))
        assert result["pruned"] == 2
        assert wdb.list_workflows_overview("image") == []

    def test_import_writes_into_user_root(self, reset_db, tmp_path, monkeypatch):
        from pathlib import Path
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        monkeypatch.setattr(wdb.seed, "add_size_node_bindings", lambda *a, **k: None)
        res = wdb.import_workflow("image", "fresh.json", json.dumps({"nodes": []}))
        assert Path(res["file_path"]).parent == user_root / "image"
        assert not (legacy / "image" / "fresh.json").exists()

    def test_builtin_detected_via_relative_path(self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "ship.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "ship_preset.json").write_text(json.dumps({"label": "ship"}))
        monkeypatch.setattr(
            wdb.bindings, "_git_tracked_cache",
            (frozenset(), frozenset({"image/ship.json"})),
        )
        wdb.seed_workflows_from_disk(("image",))
        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert rows[0]["builtin"] is True
        assert str(user_root) in rows[0]["file_path"]

    def test_shipped_update_propagates_to_untouched_copy(self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "wf.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "wf_preset.json").write_text(json.dumps({"label": "wf"}))
        wdb.seed_workflows_from_disk(("image",))
        assert wdb.set_api_json(
            "image", "wf", {"3": {"class_type": "K", "inputs": {}}},
            (user_root / "image" / "wf.json").stat().st_mtime)

        v2 = json.dumps({"nodes": [{"id": 1, "type": "NewShipped"}]})
        (legacy / "image" / "wf.json").write_text(v2)

        result = wdb.seed_workflows_from_disk(("image",))
        assert "image/wf.json" in result["updated"]
        assert result["synced"] == []
        assert (user_root / "image" / "wf.json").read_text() == v2
        assert wdb.get_workflow_config("image", "wf")["has_api"] is False

    def test_full_mirror_overwrites_local_edits(self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "wf.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "wf_preset.json").write_text(json.dumps({"label": "wf"}))
        wdb.seed_workflows_from_disk(("image",))

        edited = json.dumps({"nodes": [{"id": 9, "type": "UserEdit"}]})
        (user_root / "image" / "wf.json").write_text(edited)
        v2 = json.dumps({"nodes": [{"id": 1, "type": "NewShipped"}]})
        (legacy / "image" / "wf.json").write_text(v2)

        result = wdb.seed_workflows_from_disk(("image",))
        assert "image/wf.json" in result["updated"]
        assert (user_root / "image" / "wf.json").read_text() == v2

    def test_pre_existing_user_file_is_replaced_by_shipped(
            self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        shipped = json.dumps({"nodes": [{"id": 1, "type": "Shipped"}]})
        (legacy / "image" / "wf.json").write_text(shipped)
        (legacy / "image" / "wf_preset.json").write_text(json.dumps({"label": "wf"}))
        pre_existing = json.dumps({"nodes": [{"id": 5, "type": "Unknown"}]})
        (user_root / "image").mkdir(parents=True)
        (user_root / "image" / "wf.json").write_text(pre_existing)

        wdb.seed_workflows_from_disk(("image",))
        assert (user_root / "image" / "wf.json").read_text() == shipped

    def test_user_dir_move_repoints_rows(self, reset_db, tmp_path, monkeypatch):
        from ComfyTV import db
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        old_user = tmp_path / "old-user" / "comfytv" / "workflows" / "image"
        old_user.mkdir(parents=True)
        content = json.dumps({"nodes": []})
        (old_user / "wf.json").write_text(content)
        (legacy / "image" / "wf.json").write_text(content)
        (legacy / "image" / "wf_preset.json").write_text(json.dumps({"label": "wf"}))

        with db.get_session() as s:
            row = db.Workflow(kind="image", label="wf",
                              file_path=str(old_user / "wf.json"),
                              is_default=True, order_=100)
            s.add(row)
            s.commit()
            row_id = row.id

        wdb.seed_workflows_from_disk(("image",))

        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert rows[0]["id"] == row_id
        assert str(user_root) in rows[0]["file_path"]
        assert rows[0]["is_default"] is True

    def test_user_dir_move_keeps_preset_label_and_id(self, reset_db, tmp_path, monkeypatch):
        from ComfyTV import db
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        old_user = tmp_path / "prev" / "comfytv" / "workflows" / "image"
        old_user.mkdir(parents=True)
        content = json.dumps({"nodes": []})
        (old_user / "sd15.json").write_text(content)
        (legacy / "image" / "sd15.json").write_text(content)
        (legacy / "image" / "sd15_preset.json").write_text(
            json.dumps({"label": "SD 1.5"}))

        with db.get_session() as s:
            row = db.Workflow(kind="image", label="SD 1.5",
                              file_path=str(old_user / "sd15.json"), order_=100)
            s.add(row)
            s.commit()
            row_id = row.id

        wdb.seed_workflows_from_disk(("image",))

        rows = wdb.list_workflows_overview("image")
        assert len(rows) == 1
        assert rows[0]["id"] == row_id
        assert rows[0]["label"] == "SD 1.5"
        assert str(user_root) in rows[0]["file_path"]

    def test_two_stale_rows_for_same_rel_do_not_collide(self, reset_db, tmp_path, monkeypatch):
        from ComfyTV import db
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        content = json.dumps({"nodes": []})
        (legacy / "image" / "wf.json").write_text(content)
        old_user = tmp_path / "prev" / "comfytv" / "workflows" / "image"
        old_user.mkdir(parents=True)
        (old_user / "wf.json").write_text(content)

        with db.get_session() as s:
            s.add(db.Workflow(kind="image", label="wf",
                              file_path=str(legacy / "image" / "wf.json")))
            s.add(db.Workflow(kind="image", label="wf (old)",
                              file_path=str(old_user / "wf.json")))
            s.commit()

        wdb.seed_workflows_from_disk(("image",))

        rows = wdb.list_workflows_overview("image")
        under_new = [r for r in rows if str(user_root) in r["file_path"]]
        assert len(under_new) == 1

    def test_retired_shipped_files_removed_from_user_root(
            self, reset_db, tmp_path, monkeypatch):
        """Plugin deletes a shipped workflow → user copy + DB row go."""
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "keep.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "keep_preset.json").write_text(
            json.dumps({"label": "Keep"}))
        (legacy / "image" / "gone.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "gone_preset.json").write_text(
            json.dumps({"label": "Gone",
                        "inputs": {"3": {"seed": {"from": "option:seed"}}}}))
        wdb.seed_workflows_from_disk(("image",))
        assert {r["label"] for r in wdb.list_workflows_overview("image")} \
            == {"Keep", "Gone"}

        (legacy / "image" / "gone.json").unlink()
        (legacy / "image" / "gone_preset.json").unlink()
        result = wdb.seed_workflows_from_disk(("image",))

        assert "image/gone.json" in result["removed"]
        assert "image/gone_preset.json" in result["removed"]
        assert not (user_root / "image" / "gone.json").exists()
        assert not (user_root / "image" / "gone_preset.json").exists()
        assert (user_root / "image" / "keep.json").exists()
        labels = {r["label"] for r in wdb.list_workflows_overview("image")}
        assert labels == {"Keep"}
        assert result["pruned"] == 1

    def test_retired_edited_copy_is_also_wiped(
            self, reset_db, tmp_path, monkeypatch):
        legacy, user_root = self._setup_dirs(tmp_path, monkeypatch)
        (legacy / "image" / "fork.json").write_text(json.dumps({"nodes": []}))
        (legacy / "image" / "fork_preset.json").write_text(
            json.dumps({"label": "fork"}))
        wdb.seed_workflows_from_disk(("image",))

        edited = json.dumps({"nodes": [{"id": 1, "type": "UserFork"}]})
        (user_root / "image" / "fork.json").write_text(edited)
        (legacy / "image" / "fork.json").unlink()
        (legacy / "image" / "fork_preset.json").unlink()

        result = wdb.seed_workflows_from_disk(("image",))
        assert "image/fork.json" in result["removed"]
        assert not (user_root / "image" / "fork.json").exists()
        assert not any(
            r["label"] == "fork" for r in wdb.list_workflows_overview("image"))
