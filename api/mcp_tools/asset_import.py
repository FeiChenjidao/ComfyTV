import asyncio
import hashlib
import mimetypes
import os
import shutil
import stat as stat_module
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from ... import storage
from ...runners._media_paths import view_url_to_path
from ...runners.media_info import probe_media_path
from .._common import broadcast_asset_event
from ..assets import (
    MEDIA_EXTS,
    _media_view_url,
    _media_type_of,
    fill_media_meta,
    media_dir,
)

MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024 * 1024
MAX_FILES_WITHOUT_CONFIRMATION = 50
_HASH_CHUNK_BYTES = 1024 * 1024
_TEMP_SUFFIXES = {".tmp", ".part", ".crdownload", ".download"}


def _is_reparse_point(path: Path) -> bool:
    try:
        if path.is_symlink():
            return True
        attrs = getattr(path.stat(follow_symlinks=False), "st_file_attributes", 0)
        return bool(attrs & getattr(stat_module, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    except OSError:
        return True


def _assert_no_reparse_components(path: Path) -> None:
    current = Path(path.anchor) if path.anchor else Path()
    for part in path.parts[1:] if path.anchor else path.parts:
        current /= part
        if current.exists() and _is_reparse_point(current):
            raise ValueError(f"path contains a symbolic link or reparse point: {current}")


def _resolve_source_root(raw_path) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError("path must be an absolute local directory")
    value = raw_path.strip()
    parsed = urlparse(value)
    # ``urlparse`` treats a Windows drive letter as a URI scheme (for example
    # ``D:\\assets``), so only reject actual URI syntax here.
    if "://" in value or parsed.netloc or "\x00" in value:
        raise ValueError("path must be a local filesystem path, not a URL")
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("path must be absolute")
    if ".." in path.parts:
        raise ValueError("path traversal is not allowed")
    if not path.exists():
        raise ValueError(f"path does not exist: {value!r}")
    if not path.is_dir():
        raise ValueError(f"path is not a directory: {value!r}")
    _assert_no_reparse_components(path)
    return path.resolve()


def _is_hidden_or_temporary(path: Path) -> bool:
    if path.name.startswith(".") or path.name.endswith("~"):
        return True
    if path.suffix.lower() in _TEMP_SUFFIXES:
        return True
    try:
        attrs = getattr(path.stat(follow_symlinks=False), "st_file_attributes", 0)
        return bool(attrs & getattr(stat_module, "FILE_ATTRIBUTE_HIDDEN", 0x2))
    except OSError:
        return True


def _iter_files(root: Path, recursive: bool):
    if not recursive:
        try:
            children = sorted(root.iterdir(), key=lambda p: p.name.lower())
        except OSError as exc:
            raise ValueError(f"cannot scan directory: {exc}") from exc
        for path in children:
            if path.is_file() and not _is_hidden_or_temporary(path) \
                    and not _is_reparse_point(path):
                yield path
        return

    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        dirs[:] = [name for name in sorted(dirs, key=str.lower)
                   if not _is_hidden_or_temporary(current_path / name)
                   and not _is_reparse_point(current_path / name)]
        for name in sorted(files, key=str.lower):
            path = current_path / name
            if _is_hidden_or_temporary(path) or _is_reparse_point(path):
                continue
            if path.is_file():
                yield path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(_HASH_CHUNK_BYTES)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def _copy_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp",
        dir=str(destination.parent))
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as src:
            shutil.copyfileobj(src, out, length=_HASH_CHUNK_BYTES)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp_path, destination)
    finally:
        temp_path.unlink(missing_ok=True)


def _category_id(name: str | None, create: bool) -> int | None:
    if name is None or not str(name).strip():
        return None
    name = str(name).strip()
    existing = {row["name"]: int(row["id"])
                for row in storage.list_asset_categories()}
    if name in existing:
        return existing[name]
    if not create:
        return None
    row = storage.create_asset_category(name)
    if row is not None:
        return int(row["id"])
    for row in storage.list_asset_categories():
        if row["name"] == name:
            return int(row["id"])
    raise ValueError(f"could not create category {name!r}")


def _existing_imports() -> tuple[dict[str, dict], set[str], set[str]]:
    by_hash: dict[str, dict] = {}
    names: set[str] = set()
    by_source: set[str] = set()
    for row in storage.list_assets(limit=100000):
        names.add(str(row.get("name") or ""))
        metadata = row.get("metadata") or {}
        digest = metadata.get("import_sha256")
        if not digest:
            try:
                payload_path = view_url_to_path(row.get("payload_url"))
                if payload_path is not None and payload_path.is_file():
                    digest = _sha256(payload_path)
            except (OSError, ValueError):
                digest = None
        if digest:
            by_hash[str(digest)] = row
        source_path = metadata.get("import_source_path")
        if source_path:
            by_source.add(str(source_path))
    return by_hash, names, by_source


def _unique_name(name: str, names: set[str]) -> str:
    if name not in names:
        return name
    index = 2
    while f"{name}-{index}" in names:
        index += 1
    return f"{name}-{index}"


def _unique_destination(media_root: Path, digest: str, source_name: str,
                        force_unique: bool) -> Path:
    destination_dir = media_root / "imports" / digest[:2]
    base = f"{digest[:16]}-{source_name}"
    candidate = destination_dir / base
    if not force_unique and not candidate.exists():
        return candidate
    index = 2
    while candidate.exists():
        candidate = destination_dir / f"{digest[:16]}-{index}-{source_name}"
        index += 1
    return candidate


def _error(result: dict, path: Path, reason: str, *, skipped: bool = False) -> None:
    if skipped:
        result["skipped"] += 1
    else:
        result["failed"] += 1
    result["errors"].append({"path": str(path), "reason": reason})


def _import_folder(args: dict) -> dict:
    root = _resolve_source_root(args.get("path"))
    recursive = args.get("recursive", True)
    if not isinstance(recursive, bool):
        raise ValueError("recursive must be a boolean")
    dry_run = args.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise ValueError("dry_run must be a boolean")
    confirm = args.get("confirm", False)
    if not isinstance(confirm, bool):
        raise ValueError("confirm must be a boolean")
    conflict = str(args.get("conflict", "skip"))
    if conflict not in {"skip", "rename", "replace"}:
        raise ValueError("conflict must be 'skip', 'rename' or 'replace'")
    if conflict == "replace":
        raise ValueError(
            "conflict='replace' is not supported; use 'skip' or 'rename'")
    raw_types = args.get("media_types")
    if raw_types is None:
        media_types = set(MEDIA_EXTS) - {"text"}
    elif isinstance(raw_types, list) and all(isinstance(item, str) for item in raw_types):
        media_types = {item.strip() for item in raw_types}
        invalid = media_types - (set(MEDIA_EXTS) - {"text"})
        if invalid:
            raise ValueError(f"unsupported media_types: {sorted(invalid)}")
    else:
        raise ValueError("media_types must be an array of strings")
    files = list(_iter_files(root, recursive))
    result = {
        "root": str(root), "scanned": len(files), "imported": 0, "skipped": 0,
        "duplicates": 0, "failed": 0, "dry_run": dry_run,
        "confirmation_required": False, "assets": [], "errors": [],
    }
    if (not dry_run and len(files) > MAX_FILES_WITHOUT_CONFIRMATION
            and not confirm):
        result["confirmation_required"] = True
        result["confirmation_threshold"] = MAX_FILES_WITHOUT_CONFIRMATION
        result["plan"] = [
            {
                "path": str(path.relative_to(root)),
                "media_type": _media_type_of(path),
            }
            for path in files
        ]
        return result

    category_name = args.get("category")
    if category_name is not None and not isinstance(category_name, str):
        raise ValueError("category must be a string")
    category_name = category_name.strip() if category_name else None
    category_id = _category_id(category_name, create=not dry_run)
    existing_hashes, existing_names, existing_sources = _existing_imports()
    # ``media_dir()`` creates the managed directory.  Avoid even that side
    # effect for a dry run.
    media_root = None
    if not dry_run:
        media_root = media_dir()
        _assert_no_reparse_components(media_root)
        media_root = media_root.resolve()
    for source in files:
        media_type = _media_type_of(source)
        if media_type is None:
            _error(result, source, "unsupported format", skipped=True)
            continue
        if media_type not in media_types:
            _error(result, source, "media type filtered", skipped=True)
            continue
        try:
            size = source.stat().st_size
            if size > MAX_IMPORT_FILE_BYTES:
                _error(result, source, "file exceeds the 2GB import limit", skipped=True)
                continue
            probe = probe_media_path(source)
            if probe.get("kind") != media_type:
                _error(result, source, f"media probe identified {probe.get('kind')!r}")
                continue
            if media_type == "image" and not probe.get("width"):
                _error(result, source, "image could not be decoded")
                continue
            digest = _sha256(source)
        except Exception as exc:
            _error(result, source, f"media probe or hash failed: {exc}")
            continue
        metadata = {
            "import_sha256": digest,
            "import_source_rel": str(source.relative_to(root)),
            "import_source_path": str(source),
        }
        duplicate = digest in existing_hashes or str(source) in existing_sources
        source_name = str(source.relative_to(root))
        if digest in existing_hashes or str(source) in existing_sources:
            result["duplicates"] += 1
        if duplicate and conflict == "skip":
            _error(result, source,
                   "duplicate content or previously imported path",
                   skipped=True)
            continue
        name = source.stem
        force_unique = duplicate or name in existing_names or conflict == "rename"
        if force_unique:
            name = _unique_name(name, existing_names)
        if dry_run:
            result["assets"].append({
                "asset_id": None, "name": name, "media_type": media_type,
                "path": source_name,
            })
            continue
        destination = _unique_destination(
            media_root, digest, source.name, force_unique)
        _assert_no_reparse_components(destination.parent)
        try:
            destination.parent.resolve().relative_to(media_root)
        except ValueError as exc:
            raise RuntimeError("asset destination escaped managed media storage") from exc
        payload_url = _media_view_url(destination.relative_to(media_root))
        try:
            _copy_atomic(source, destination)
            meta = fill_media_meta(payload_url, {
                "mime_type": mimetypes.guess_type(destination.name)[0],
                "width": probe.get("width"),
                "height": probe.get("height"),
                "size_bytes": size,
            })
            row = storage.create_asset(
                name=name, payload_url=payload_url, media_type=media_type,
                category_ids=[category_id] if category_id is not None else [],
                source="mcp-folder", metadata=metadata, **meta)
            if row is None:
                raise RuntimeError("asset database rejected the record")
        except Exception as exc:
            try:
                destination.unlink(missing_ok=True)
            except OSError:
                pass
            for parent in (destination.parent, destination.parent.parent):
                if parent == media_root:
                    break
                try:
                    parent.rmdir()
                except OSError:
                    pass
            _error(result, source, f"import failed: {exc}")
            continue
        existing_hashes[digest] = row
        existing_sources.add(str(source))
        existing_names.add(name)
        result["imported"] += 1
        result["assets"].append({
            "asset_id": row["id"], "name": row["name"],
            "media_type": row["media_type"],
        })
        broadcast_asset_event("create", {"asset": row})
    return result


async def _asset_import_folder(args: dict) -> dict:
    return await asyncio.to_thread(_import_folder, args)


TOOLS = {
    "asset_import_folder": {
        "description": (
            "Import local image, video, audio, or model files into the existing "
            "ComfyTV asset library from an absolute local directory. Files are "
            "copied, never moved; "
            "hidden and temporary files are ignored. Use dry_run to inspect the "
            "plan. Imports over 50 files require confirm=true. "
            "conflict='replace' is intentionally unsupported."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "recursive": {"type": "boolean", "default": True},
                "category": {"type": "string"},
                "media_types": {
                    "type": "array",
                    "items": {"type": "string",
                              "enum": ["image", "video", "audio", "model"]},
                },
                "conflict": {"type": "string",
                             "enum": ["skip", "rename", "replace"]},
                "dry_run": {"type": "boolean", "default": False},
                "confirm": {"type": "boolean", "default": False},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        "handler": _asset_import_folder,
    },
}
