import os
import time
import uuid

import folder_paths

_NAMESPACE = uuid.UUID("2d1f7c1e-5b8a-4c4e-9a6d-4f0c2b7e8a11")
_LIST_MAX = 500


def root() -> str:
    return os.path.join(folder_paths.get_user_directory(), "default", "workflows")


def workflow_id(rel: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, rel.replace("\\", "/")))


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _name(rel: str) -> str:
    base = rel.rsplit("/", 1)[-1]
    return base[:-5] if base.endswith(".json") else base


def entries() -> list[dict]:
    base = root()
    out: list[dict] = []
    if not os.path.isdir(base):
        return out
    for dirpath, _dirs, files in os.walk(base):
        for name in files:
            if not name.endswith(".json"):
                continue
            full = os.path.join(dirpath, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, base).replace("\\", "/")
            out.append({
                "id": workflow_id(rel),
                "name": _name(rel),
                "created_at": _iso(st.st_ctime),
                "updated_at": _iso(st.st_mtime),
                "created_by": "local",
                "latest_version": 1,
                "_path": rel,
                "_mtime": st.st_mtime,
            })
    out.sort(key=lambda w: w["_mtime"], reverse=True)
    return out[:_LIST_MAX]


def path_for(target_id: str) -> str | None:
    for entry in entries():
        if entry["id"] == target_id:
            return entry["_path"]
    return None


def public(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if not k.startswith("_")}
