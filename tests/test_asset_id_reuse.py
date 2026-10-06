import sqlite3

import pytest


def _new_asset(storage, name):
    return storage.create_asset(name=name, payload_url=f"/view?filename={name}.png&type=output",
                                media_type="image")["id"]


def test_deleted_asset_id_is_never_reissued(reset_db):
    from ComfyTV import storage
    a = _new_asset(storage, "a")
    b = _new_asset(storage, "b")
    assert storage.delete_asset(b)
    c = _new_asset(storage, "c")
    assert c > b > a


@pytest.fixture()
def make_legacy_db(tmp_path, monkeypatch):
    from ComfyTV import db as comfytv_db
    from ComfyTV.runners.workflow_db import seed as wdb_seed
    monkeypatch.setattr(comfytv_db, "_engine", None, raising=True)
    monkeypatch.setattr(comfytv_db, "_Session", None, raising=True)
    user_dir = tmp_path / "user" / "default"
    (user_dir / "comfytv").mkdir(parents=True)
    import folder_paths
    monkeypatch.setattr(folder_paths, "get_user_directory", lambda: str(user_dir))
    monkeypatch.setattr(wdb_seed, "_LEGACY_WORKFLOWS_DIR", tmp_path / "legacy-unused")

    def make(extra_sql=""):
        con = sqlite3.connect(user_dir / "comfytv" / "data.db")
        con.executescript(_LEGACY_SQL + extra_sql)
        con.commit()
        con.close()
        comfytv_db.init()
        return comfytv_db
    return make


@pytest.fixture()
def legacy_db(make_legacy_db):
    return make_legacy_db()


_LEGACY_SQL = """
        CREATE TABLE comfytv_asset_categories (
            id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL UNIQUE,
            "order" INTEGER NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
        CREATE TABLE comfytv_assets (
            id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, media_type VARCHAR NOT NULL,
            payload_url TEXT NOT NULL, mime_type VARCHAR, width INTEGER, height INTEGER,
            size_bytes INTEGER, source VARCHAR, metadata_json TEXT,
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
        CREATE INDEX ix_comfytv_assets_media_type ON comfytv_assets (media_type);
        CREATE TABLE comfytv_asset_category_links (
            asset_id INTEGER NOT NULL REFERENCES comfytv_assets (id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES comfytv_asset_categories (id) ON DELETE CASCADE,
            PRIMARY KEY (asset_id, category_id));
        INSERT INTO comfytv_asset_categories VALUES (1, '角色', 100, '2026-01-01', '2026-01-01');
        INSERT INTO comfytv_assets VALUES
            (1, 'keep', 'image', '/view?filename=keep.png', NULL, 64, 64, NULL, NULL, NULL, '2026-01-01', '2026-01-01'),
            (2, 'last', 'image', '/view?filename=last.png', NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-01', '2026-01-01');
        INSERT INTO comfytv_asset_category_links VALUES (1, 1);
"""


def test_legacy_asset_table_migrates_keeping_rows_and_links(legacy_db):
    from ComfyTV import storage
    from sqlalchemy import text
    with legacy_db._engine.connect() as conn:
        sql = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE name='comfytv_assets'")).scalar()
        links = conn.execute(text("SELECT asset_id, category_id FROM comfytv_asset_category_links")).all()
        index = conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='ix_comfytv_assets_media_type'")).scalar()
    assert "AUTOINCREMENT" in sql.upper()
    assert links == [(1, 1)]
    assert index == "ix_comfytv_assets_media_type"
    rows = {r["id"]: r for r in storage.list_assets()}
    assert rows[1]["name"] == "keep" and rows[1]["width"] == 64

    assert storage.delete_asset(2)
    assert _new_asset(storage, "new") == 3


def test_migration_refuses_when_an_asset_reference_would_dangle(make_legacy_db):
    db = make_legacy_db("INSERT INTO comfytv_asset_category_links VALUES (99, 1);")
    from sqlalchemy import text
    with db._engine.connect() as conn:
        sql = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE name='comfytv_assets'")).scalar()
        assets = conn.execute(text("SELECT id FROM comfytv_assets ORDER BY id")).scalars().all()
        links = conn.execute(text(
            "SELECT asset_id FROM comfytv_asset_category_links ORDER BY asset_id")).scalars().all()
    assert "AUTOINCREMENT" not in sql.upper()
    assert assets == [1, 2]
    assert links == [1, 99]
