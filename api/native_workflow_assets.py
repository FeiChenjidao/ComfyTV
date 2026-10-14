"""Pack / restore workflow media for native team-git sync.

v1: images / audio / video referenced by Load* and ComfyTV loader stages.
Models are never packed. Paths stay as-is in the JSON; restore copies into
ComfyUI input/output/temp so existing widgets keep working.
"""
from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote

_log = logging.getLogger(__name__)

_ASSETS_DIR = "_assets"
_MAX_IMAGE_BYTES = 50 * 1024 * 1024
_MAX_AV_BYTES = 200 * 1024 * 1024
_MAX_PER_WORKFLOW_BYTES = 500 * 1024 * 1024

_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".psd", ".psb"}
_AV_EXT = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".mp3", ".wav", ".flac", ".ogg", ".m4a"}

# Node types whose widgets_values carry a primary media path.
_LOADER_TYPES = {
    "LoadImage",
    "LoadImageMask",
    "LoadImageOutput",
    "LoadVideo",
    "LoadAudio",
    "ComfyTV.ImageLoaderStage",
    "ComfyTV.AssetImageLoaderStage",
    "ComfyTV.AssetVideoLoaderStage",
    "ComfyTV.AssetAudioLoaderStage",
}


@dataclass
class PackResult:
    added: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    packed_files: int = 0
    packed_bytes: int = 0


@dataclass
class RestoreResult:
    restored: int = 0
    skipped: int = 0
    warnings: list[str] = field(default_factory=list)


def _looks_like_media_ref(value: str) -> bool:
    text = (value or "").strip()
    if not text or text.startswith("http://") or text.startswith("https://"):
        return False
    if text.startswith("/view?"):
        return True
    if "[" in text and text.rstrip().endswith("]"):
        return True
    lower = text.lower().split("?", 1)[0]
    return any(lower.endswith(ext) for ext in (_IMAGE_EXT | _AV_EXT))


def _refs_from_node(node: dict[str, Any]) -> list[str]:
    ntype = str(node.get("type") or node.get("class_type") or "")
    wv = node.get("widgets_values") or []
    refs: list[str] = []

    def add(v: Any) -> None:
        if isinstance(v, str) and _looks_like_media_ref(v):
            refs.append(v.strip())

    if ntype in ("LoadImage", "LoadImageMask", "LoadImageOutput", "LoadVideo", "LoadAudio"):
        if wv:
            add(wv[0])
    elif ntype in (
        "ComfyTV.ImageLoaderStage",
        "ComfyTV.AssetImageLoaderStage",
        "ComfyTV.AssetVideoLoaderStage",
        "ComfyTV.AssetAudioLoaderStage",
    ):
        if len(wv) >= 3:
            add(wv[2])
    elif ntype in _LOADER_TYPES:
        for v in wv:
            add(v)

    # Nested JSON blobs (e.g. ImagePickerStage image_url lists)
    for v in wv:
        if not isinstance(v, str) or not v.startswith("{"):
            continue
        try:
            blob = json.loads(v)
        except Exception:
            continue
        stack: list[Any] = [blob]
        while stack:
            cur = stack.pop()
            if isinstance(cur, dict):
                for key, val in cur.items():
                    if key in ("image_url", "url", "src", "filename", "path", "image") and isinstance(val, str):
                        add(val)
                    else:
                        stack.append(val)
            elif isinstance(cur, list):
                stack.extend(cur)

    # Dedup preserve order
    seen: set[str] = set()
    out: list[str] = []
    for r in refs:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def _to_annotated(ref: str) -> Optional[str]:
    text = ref.strip()
    if not text:
        return None
    if text.startswith("/view?"):
        try:
            from ..runners._workflow_resolve import _view_url_to_annotated
            return _view_url_to_annotated(text)
        except Exception as e:
            _log.debug("[ComfyTV/assets] view url parse failed: %s", e)
            return None
    return text


def _resolve_disk_path(ref: str) -> Optional[Path]:
    annotated = _to_annotated(ref)
    if not annotated:
        return None
    try:
        import folder_paths
        path = Path(folder_paths.get_annotated_filepath(annotated))
    except Exception:
        return None
    try:
        if path.is_file():
            return path.resolve()
    except OSError:
        return None
    return None


def _storage_key(path: Path) -> Optional[tuple[str, str]]:
    """Return (root_kind, rel_posix) for input|output|temp, else None."""
    try:
        import folder_paths
        bases = (
            ("input", Path(folder_paths.get_input_directory()).resolve()),
            ("output", Path(folder_paths.get_output_directory()).resolve()),
            ("temp", Path(folder_paths.get_temp_directory()).resolve()),
        )
    except Exception:
        return None
    resolved = path.resolve()
    for kind, base in bases:
        try:
            rel = resolved.relative_to(base)
            return kind, rel.as_posix()
        except ValueError:
            continue
    return None


def _max_for(path: Path) -> int:
    ext = path.suffix.lower()
    if ext in _AV_EXT:
        return _MAX_AV_BYTES
    return _MAX_IMAGE_BYTES


def _wf_asset_dir(root: Path, workflow_rel: str) -> Path:
    stem = Path(workflow_rel).with_suffix("").as_posix()
    return root / _ASSETS_DIR / stem


def scan_workflow_media(doc: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for node in doc.get("nodes") or []:
        if isinstance(node, dict):
            refs.extend(_refs_from_node(node))
    # unique
    seen: set[str] = set()
    out: list[str] = []
    for r in refs:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def pack_for_workflows(root: Path, workflow_rels: list[str]) -> PackResult:
    result = PackResult()
    for rel in workflow_rels:
        wf_path = root / rel
        if not wf_path.is_file():
            result.warnings.append(f"missing workflow: {rel}")
            continue
        try:
            doc = json.loads(wf_path.read_text(encoding="utf-8"))
        except Exception as e:
            result.warnings.append(f"cannot parse {rel}: {e}")
            continue

        dest_root = _wf_asset_dir(root, rel)
        dest_root.mkdir(parents=True, exist_ok=True)
        used = 0
        for ref in scan_workflow_media(doc):
            disk = _resolve_disk_path(ref)
            if disk is None:
                result.warnings.append(f"{rel}: asset not found ({ref[:80]})")
                continue
            key = _storage_key(disk)
            if key is None:
                result.warnings.append(f"{rel}: asset outside input/output/temp ({disk.name})")
                continue
            kind, store_rel = key
            try:
                size = disk.stat().st_size
            except OSError as e:
                result.warnings.append(f"{rel}: cannot stat {disk.name}: {e}")
                continue
            if size > _max_for(disk):
                result.warnings.append(
                    f"{rel}: skip oversized {store_rel} ({size // (1024 * 1024)}MB)"
                )
                continue
            if used + size > _MAX_PER_WORKFLOW_BYTES:
                result.warnings.append(f"{rel}: workflow asset budget exceeded, skipped rest")
                break

            dest = dest_root / kind / store_rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                if dest.exists() and dest.stat().st_size == size:
                    # cheap same-size skip; still stage path
                    pass
                else:
                    shutil.copy2(disk, dest)
                rel_git = dest.relative_to(root).as_posix()
                result.added.append(rel_git)
                result.packed_files += 1
                result.packed_bytes += size
                used += size
            except OSError as e:
                result.warnings.append(f"{rel}: copy failed {store_rel}: {e}")

        # Always stage the asset folder if it exists (keeps deletes in sync later)
        if dest_root.is_dir():
            result.added.append(dest_root.relative_to(root).as_posix())

    # unique add paths
    seen: set[str] = set()
    uniq: list[str] = []
    for p in result.added:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    result.added = uniq
    return result


def restore_assets(root: Path) -> RestoreResult:
    result = RestoreResult()
    assets = root / _ASSETS_DIR
    if not assets.is_dir():
        return result

    try:
        import folder_paths
        roots = {
            "input": Path(folder_paths.get_input_directory()),
            "output": Path(folder_paths.get_output_directory()),
            "temp": Path(folder_paths.get_temp_directory()),
        }
    except Exception as e:
        result.warnings.append(f"folder_paths unavailable: {e}")
        return result

    for kind, base in roots.items():
        # layout: _assets/<wf>/<kind>/<rel...>
        for wf_dir in assets.iterdir():
            if not wf_dir.is_dir():
                continue
            cand = wf_dir / kind
            if not cand.is_dir():
                continue
            for src in cand.rglob("*"):
                if not src.is_file():
                    continue
                if src.name.startswith("."):
                    continue
                rel = src.relative_to(cand).as_posix()
                # decode accidental %2F segments in stored names
                rel = unquote(rel)
                dest = (base / rel).resolve()
                try:
                    dest.relative_to(base.resolve())
                except ValueError:
                    result.warnings.append(f"skip unsafe asset path: {rel}")
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                try:
                    if dest.exists():
                        if dest.stat().st_size == src.stat().st_size:
                            result.skipped += 1
                            continue
                        # Different content: keep local, warn
                        result.skipped += 1
                        result.warnings.append(f"kept local (differs): {kind}/{rel}")
                        continue
                    shutil.copy2(src, dest)
                    result.restored += 1
                except OSError as e:
                    result.warnings.append(f"restore failed {kind}/{rel}: {e}")
    return result
