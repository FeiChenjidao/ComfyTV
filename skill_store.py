import json
import logging
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

BUILTIN_SKILLS_DIR = Path(__file__).resolve().parent / "skills"
SKILL_FILE = "SKILL.md"
OPENAI_META = Path("agents") / "openai.yaml"
DISABLED_SETTING = "skills-disabled"
ENABLE_SETTING = "enable-skills"

NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
NAME_MAX = 64
DESCRIPTION_MAX = 1024
FILE_BYTES_MAX = 512 * 1024


def user_skills_dir() -> Path:
    import folder_paths
    return Path(folder_paths.get_user_directory()) / "comfytv" / "skills"


def skills_enabled() -> bool:
    from . import storage
    try:
        return bool(storage.get_setting(ENABLE_SETTING))
    except Exception:
        logger.exception("[ComfyTV/skills] enable-skills lookup failed")
        return False


def disabled_names() -> set[str]:
    from . import storage
    try:
        raw = storage.get_setting(DISABLED_SETTING)
        data = json.loads(str(raw) or "[]")
    except Exception:
        return set()
    if not isinstance(data, list):
        return set()
    return {str(n) for n in data}


def set_skill_enabled(name: str, enabled: bool) -> None:
    from . import storage
    names = disabled_names()
    if enabled:
        names.discard(name)
    else:
        names.add(name)
    storage.set_settings({DISABLED_SETTING: json.dumps(sorted(names))})


def parse_frontmatter(text: str) -> tuple[Optional[dict], str]:
    if not text.startswith("---"):
        return None, text
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return None, text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            import yaml
            try:
                meta = yaml.safe_load("".join(lines[1:i]))
            except yaml.YAMLError:
                return None, text
            body = "".join(lines[i + 1:])
            return (meta if isinstance(meta, dict) else None), body
    return None, text


def _display_meta(skill_dir: Path) -> dict:
    path = skill_dir / OPENAI_META
    if not path.is_file():
        return {}
    import yaml
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, yaml.YAMLError):
        return {}
    interface = data.get("interface") if isinstance(data, dict) else None
    if not isinstance(interface, dict):
        return {}
    out = {}
    if interface.get("display_name"):
        out["display_name"] = str(interface["display_name"])
    return out


def scan_dir(skill_dir: Path, source: str) -> Optional[dict]:
    path = skill_dir / SKILL_FILE
    if not path.is_file():
        return None
    entry: dict[str, Any] = {
        "name": skill_dir.name,
        "description": "",
        "display_name": "",
        "source": source,
        "dir": str(skill_dir),
        "valid": False,
        "error": "",
    }
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        entry["error"] = f"unreadable SKILL.md: {e}"
        return entry
    meta, _ = parse_frontmatter(raw)
    if meta is None:
        entry["error"] = "SKILL.md has no valid YAML frontmatter"
        return entry
    name = str(meta.get("name") or skill_dir.name).strip()
    description = str(meta.get("description") or "").strip()
    if not NAME_RE.match(name) or len(name) > NAME_MAX:
        entry["error"] = f"invalid skill name {name!r}"
        return entry
    if not description:
        entry["name"] = name
        entry["error"] = "frontmatter is missing a description"
        return entry
    entry.update({
        "name": name,
        "description": description[:DESCRIPTION_MAX],
        "valid": True,
    })
    entry.update(_display_meta(skill_dir))
    return entry


def _scan_root(root: Path, source: str) -> list[dict]:
    if not root.is_dir():
        return []
    out = []
    try:
        children = sorted(p for p in root.iterdir()
                          if p.is_dir() and not p.name.startswith("."))
    except OSError:
        return []
    for child in children:
        entry = scan_dir(child, source)
        if entry is not None:
            out.append(entry)
    return out


def scan() -> list[dict]:
    disabled = disabled_names()
    merged: dict[str, dict] = {}
    for entry in _scan_root(BUILTIN_SKILLS_DIR, "builtin"):
        merged[entry["name"]] = entry
    for entry in _scan_root(user_skills_dir(), "user"):
        if entry["name"] in merged:
            entry["overrides_builtin"] = True
        merged[entry["name"]] = entry
    out = list(merged.values())
    for entry in out:
        entry["enabled"] = entry["valid"] and entry["name"] not in disabled
    return out


def enabled_skills() -> list[dict]:
    if not skills_enabled():
        return []
    return [s for s in scan() if s["enabled"]]


def find(name: str) -> Optional[dict]:
    for entry in scan():
        if entry["name"] == name:
            return entry
    return None


def find_enabled(name: str) -> Optional[dict]:
    for entry in enabled_skills():
        if entry["name"] == name:
            return entry
    return None


def read_skill(name: str) -> str:
    entry = find(name)
    if entry is None:
        raise ValueError(f"unknown skill {name!r}")
    return (Path(entry["dir"]) / SKILL_FILE).read_text(
        encoding="utf-8", errors="replace")


def read_skill_file(name: str, relpath: str) -> str:
    entry = find(name)
    if entry is None:
        raise ValueError(f"unknown skill {name!r}")
    rel = Path(str(relpath).replace("\\", "/"))
    if rel.is_absolute() or ".." in rel.parts or not rel.parts:
        raise ValueError(f"invalid path {relpath!r}")
    root = Path(entry["dir"]).resolve()
    target = (root / rel).resolve()
    if root not in target.parents:
        raise ValueError(f"invalid path {relpath!r}")
    if not target.is_file():
        raise ValueError(f"no file {relpath!r} in skill {name!r}")
    if target.stat().st_size > FILE_BYTES_MAX:
        raise ValueError(f"{relpath!r} is too large to read (>512KB)")
    return target.read_text(encoding="utf-8", errors="replace")


def _edit_name(name: str) -> str:
    if not isinstance(name, str) or not name or len(name) > NAME_MAX:
        raise ValueError("skill name must be 1-64 safe characters")
    if not NAME_RE.fullmatch(name):
        raise ValueError(
            "skill name may contain only letters, numbers, '-' and '_'")
    return name


def _user_skill_dir(name: str) -> tuple[Path, Path]:
    name = _edit_name(name)
    root = user_skills_dir().resolve()
    target = root / name
    resolved = target.resolve(strict=False)
    if resolved.parent != root:
        raise ValueError("skill path must stay inside the user Skill root")
    return root, target


def validate_skill(name: str, content: str) -> dict:
    name = _edit_name(name)
    if not isinstance(content, str):
        raise ValueError("content must be a string")
    if not content.strip():
        raise ValueError("SKILL.md must not be empty")
    meta, body = parse_frontmatter(content)
    if meta is None:
        raise ValueError("SKILL.md has no valid YAML frontmatter")
    meta_name = meta.get("name")
    if not isinstance(meta_name, str) or meta_name != name:
        raise ValueError(
            f"frontmatter name must match target skill {name!r}")
    description = meta.get("description")
    if not isinstance(description, str) or not description.strip():
        raise ValueError("frontmatter is missing a description")
    if not body.strip():
        raise ValueError("SKILL.md body must not be empty")
    if len(content.encode("utf-8")) > FILE_BYTES_MAX:
        raise ValueError("SKILL.md is too large (>512KB)")
    return {
        "name": name,
        "description": description.strip()[:DESCRIPTION_MAX],
    }


def _atomic_write(path: Path, content: str) -> None:
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def reload() -> list[dict]:
    """Refresh and return the current on-disk Skill registry."""
    return scan()


def edit_skill(action: str, name: str | None = None,
               content: str | None = None) -> dict:
    if action == "validate":
        if name is None or content is None:
            raise ValueError("name and content are required for validation")
        return {"valid": True, **validate_skill(name, content)}
    if action == "reload":
        entries = reload()
        return {"reloaded": True, "skills": entries}
    if action not in ("create", "update"):
        raise ValueError(
            f"unknown action {action!r} (use 'create', 'update', "
            "'validate' or 'reload')")
    if name is None or content is None:
        raise ValueError(f"name and content are required for action={action!r}")
    metadata = validate_skill(name, content)
    root, target = _user_skill_dir(name)
    if action == "create":
        if target.exists() or target.is_symlink() or find(name) is not None:
            raise ValueError(f"skill {name!r} already exists")
        root.mkdir(parents=True, exist_ok=True)
        created_dir = False
        try:
            target.mkdir()
            created_dir = True
            _atomic_write(target / SKILL_FILE, content)
        except Exception:
            if created_dir:
                shutil.rmtree(target, ignore_errors=True)
            raise
    else:
        if target.is_symlink() or not target.is_dir():
            if find(name) is not None:
                raise ValueError(f"built-in skill {name!r} cannot be updated")
            raise ValueError(f"skill {name!r} does not exist")
        _atomic_write(target / SKILL_FILE, content)
    fresh = next((entry for entry in reload() if entry["name"] == name), None)
    return {"ok": True, "action": action, "skill": fresh or metadata}
