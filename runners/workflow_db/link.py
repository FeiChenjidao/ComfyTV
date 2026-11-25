import json
import logging
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select

from ... import db
from .auto_bind import add_size_node_bindings
from .labels import _label_from_stem, _is_gui_format
from .convert import _node_schema
from ..workflow_templates import prepare_template_graph, workflow_nodes

_log = logging.getLogger(__name__)


def resolve_request_user_id(request: Any = None) -> str:
    """Current ComfyUI user id (`default` when multi-user is off)."""
    if request is None:
        return "default"
    try:
        from server import PromptServer
        return str(PromptServer.instance.user_manager.get_request_user_id(request))
    except Exception:
        pass
    try:
        raw = request.headers.get("Comfy-User") or request.headers.get("comfy-user") or ""
        raw = str(raw).strip()
        if raw:
            import folder_paths
            if folder_paths.get_public_user_directory(raw):
                return raw
    except Exception:
        pass
    return "default"


def _native_workflows_dir(user_id: Optional[str] = None) -> Optional[Path]:
    """Per-user ComfyUI workflow library: user/<id>/workflows.

    Multi-user: each login gets their own dir (and their own team-git working copy).
    Single-user: id is always ``default``.
    """
    try:
        import folder_paths
    except Exception:
        return None
    try:
        uid = (user_id or "default").strip() or "default"
        base = folder_paths.get_public_user_directory(uid)
        if not base:
            return None
        return Path(base) / "workflows"
    except Exception:
        return None


def _template_workflows_dir() -> Path:
    """ComfyUI-recognized custom-node template directory for ComfyTV."""
    return Path(__file__).resolve().parents[2] / "example_workflows"


def _resolve_native_path(rel_path: str, user_id: Optional[str] = None) -> Optional[Path]:
    root = _native_workflows_dir(user_id)
    if root is None:
        return None
    root = root.resolve()
    candidate = (root / rel_path).resolve()
    try:
        if candidate != root and root not in candidate.parents:
            return None
    except Exception:
        return None
    return candidate


def _resolve_template_path(rel_path: str) -> Optional[Path]:
    root = _template_workflows_dir().resolve()
    candidate = (root / rel_path).resolve()
    try:
        if candidate != root and root not in candidate.parents:
            return None
    except Exception:
        return None
    return candidate


def list_native_workflows(
    kind: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[dict]:
    root = _native_workflows_dir(user_id)
    if root is None or not root.is_dir():
        return []

    root = root.resolve()
    db.init()
    with db.get_session() as s:
        q = select(db.Workflow.file_path, db.Workflow.id).where(
            db.Workflow.link_type == db.LINK_TYPE_NATIVE
        )
        if kind:
            q = q.where(db.Workflow.kind == kind)
        linked_by_path: dict[str, int] = {}
        for p, rid in s.execute(q).all():
            try:
                linked_by_path[str(Path(p).resolve())] = rid
            except Exception:
                continue

    items: list[dict] = []
    for path in root.rglob("*.json"):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part.startswith(".") for part in rel_parts):
            continue
        if path.stem.endswith("_preset") or path.name.endswith(".api.json"):
            continue
        try:
            st = path.stat()
        except OSError:
            continue
        rel = path.relative_to(root).as_posix()
        linked_id = linked_by_path.get(str(path.resolve()))
        items.append({
            "path":     rel,
            "name":     path.stem,
            "mtime":    st.st_mtime,
            "size":     st.st_size,
            "is_linked": linked_id is not None,
            "linked_id": linked_id,
        })
    items.sort(key=lambda it: it["mtime"], reverse=True)
    return items


def list_template_workflows() -> list[dict]:
    """List team templates without exposing them as user workflow files."""
    root = _template_workflows_dir()
    if not root.is_dir():
        return []
    root = root.resolve()
    items: list[dict] = []
    for path in root.rglob("*.json"):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part.startswith(".") for part in rel_parts):
            continue
        if path.stem.endswith("_preset") or path.name.endswith(".api.json"):
            continue
        try:
            st = path.stat()
        except OSError:
            continue
        items.append({
            "path": path.relative_to(root).as_posix(),
            "name": path.stem,
            "mtime": st.st_mtime,
            "size": st.st_size,
            "is_linked": False,
            "linked_id": None,
        })
    items.sort(key=lambda it: it["mtime"], reverse=True)
    return items


def prepare_native_workflow_template(data: dict, *, new_instance: bool = False) -> dict:
    import nodes

    mappings = nodes.NODE_CLASS_MAPPINGS
    classes = {node.get("type") for node in workflow_nodes(data)}
    schemas = {
        name: _node_schema(name, mappings[name]) or {}
        for name in classes if isinstance(name, str)
        and name.startswith("ComfyTV.") and name in mappings
    }
    return prepare_template_graph(data, schemas, new_instance=new_instance)


def instantiate_native_workflow_template(
    rel_path: str,
    user_id: Optional[str] = None,
) -> dict:
    """Prepare a new unsaved workflow from a template without touching the source."""
    source = _resolve_template_path(rel_path)
    if source is None:
        raise ValueError("path is outside ComfyTV's template library")
    if not source.is_file():
        raise ValueError(f"workflow file not found: {rel_path}")

    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except OSError as e:
        raise ValueError(f"could not read workflow file: {e}") from e
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid workflow json: {e}") from e
    if not isinstance(data, dict) or not isinstance(data.get("nodes"), list):
        raise ValueError(
            "not a GUI-format workflow (missing a top-level 'nodes' array)"
        )

    data = prepare_native_workflow_template(data, new_instance=True)
    native_root = _native_workflows_dir(user_id)
    if native_root is None:
        raise ValueError("ComfyUI workflow library is unavailable")
    native_root = native_root.resolve()
    local_dir = (native_root / "_local").resolve()
    if native_root not in local_dir.parents:
        raise ValueError("local workflow directory is outside the workflow library")
    local_dir.mkdir(parents=True, exist_ok=True)

    suffix = 1
    while True:
        name = source.stem if suffix == 1 else f"{source.stem} {suffix}"
        destination = local_dir / f"{name}.json"
        if not destination.exists():
            break
        suffix += 1

    return {
        "path": destination.relative_to(native_root).as_posix(),
        "graph": data,
    }


def link_workflow(
    kind: str,
    rel_path: str,
    label: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict:
    db.init()

    path = _resolve_native_path(rel_path, user_id=user_id)
    if path is None:
        raise ValueError("path is outside ComfyUI's workflow library")
    if not path.is_file():
        raise ValueError(f"workflow file not found: {rel_path}")

    try:
        content = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ValueError(f"could not read workflow file: {e}")
    if not _is_gui_format(content):
        raise ValueError(
            "not a GUI-format workflow (missing a top-level 'nodes' array)"
        )

    lbl = (label or "").strip() or _label_from_stem(path.stem)
    abs_path = str(path)
    mtime = path.stat().st_mtime

    with db.get_session() as s:
        dup_label = s.execute(
            select(db.Workflow).where(
                db.Workflow.kind == kind, db.Workflow.label == lbl
            )
        ).scalar_one_or_none()
        if dup_label is not None:
            raise ValueError(f"a workflow named {lbl!r} already exists for {kind}")

        dup_link = s.execute(
            select(db.Workflow).where(
                db.Workflow.kind == kind, db.Workflow.file_path == abs_path
            )
        ).scalar_one_or_none()
        if dup_link is not None:
            raise ValueError("this workflow is already linked for this kind")

        row = db.Workflow(
            kind=kind,
            label=lbl,
            file_path=abs_path,
            file_mtime=mtime,
            link_type=db.LINK_TYPE_NATIVE,
            order_=100,
        )
        s.add(row)
        s.flush()
        add_size_node_bindings(s, row, content)
        s.commit()
        result = {"kind": row.kind, "label": row.label, "id": row.id,
                  "file_path": row.file_path, "link_type": db.LINK_TYPE_NATIVE}

    _log.info("[ComfyTV/workflow_db] linked %s/%s -> %s", kind, lbl, abs_path)
    return result


def unlink_workflow(workflow_id: int) -> Optional[dict]:
    db.init()
    with db.get_session() as s:
        row = s.get(db.Workflow, workflow_id)
        if row is None:
            return None
        if row.link_type != db.LINK_TYPE_NATIVE:
            raise ValueError("only linked workflows can be unlinked")
        info = {"kind": row.kind, "label": row.label}
        s.execute(
            db.WorkflowInputBinding.__table__.delete()
            .where(db.WorkflowInputBinding.workflow_id == row.id)
        )
        s.delete(row)
        s.commit()
    _log.info("[ComfyTV/workflow_db] unlinked %s/%s", info["kind"], info["label"])
    return {"ok": True, **info}
