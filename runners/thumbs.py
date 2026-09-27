import hashlib
import os
import uuid
from pathlib import Path

import folder_paths

from .media import view_url_to_path

THUMB_SIZES = (256, 512, 1024)
THUMB_SUBFOLDER = 'comfytv/thumbs'
THUMB_SKIP_FACTOR = 1.25
THUMB_QUALITY = 85
THUMB_MAX_FILES = 512
THUMB_MAX_BYTES = 256 * 1024 * 1024
IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}
VIDEO_EXTS = {'.3g2', '.3gp', '.avi', '.m4v', '.mkv', '.mov', '.mp4',
              '.mpeg', '.mpg', '.ogv', '.webm'}


def thumb_dir() -> Path:
    d = Path(folder_paths.get_output_directory()) / THUMB_SUBFOLDER
    d.mkdir(parents=True, exist_ok=True)
    return d


def snap_size(max_edge: int) -> int:
    for size in THUMB_SIZES:
        if max_edge <= size:
            return size
    return THUMB_SIZES[-1]


def _thumb_dest(src: Path, size: int, kind: str) -> Path:
    st = src.stat()
    key = hashlib.sha1(
        f'{kind}|{src}|{st.st_size}|{st.st_mtime_ns}|{size}'.encode()).hexdigest()
    return thumb_dir() / f'{key}.webp'


def _save_webp(im, dest: Path) -> None:
    tmp = dest.with_name(f'{dest.stem}.{uuid.uuid4().hex[:8]}.tmp')
    im.save(tmp, format='webp', quality=THUMB_QUALITY)
    os.replace(tmp, dest)
    _prune_thumb_cache(dest)


def _prune_thumb_cache(keep: Path) -> None:
    files = []
    total = 0
    for path in thumb_dir().glob('*.webp'):
        try:
            st = path.stat()
        except OSError:
            continue
        files.append((path, st.st_mtime_ns, st.st_size))
        total += st.st_size
    if len(files) <= THUMB_MAX_FILES and total <= THUMB_MAX_BYTES:
        return

    files.sort(key=lambda item: (item[0] == keep, item[1]), reverse=True)
    kept_files = 0
    kept_bytes = 0
    for path, _mtime, size in files:
        if path == keep or (kept_files < THUMB_MAX_FILES and kept_bytes + size <= THUMB_MAX_BYTES):
            kept_files += 1
            kept_bytes += size
            continue
        try:
            path.unlink()
        except OSError:
            pass


def _video_thumb(src: Path, size: int) -> Path:
    dest = _thumb_dest(src, size, 'video')
    if dest.is_file():
        return dest

    import av
    from PIL import Image

    im = None
    try:
        with av.open(str(src)) as container:
            for frame in container.decode(container.streams.video[0]):
                im = frame.to_image()
                break
    except Exception as e:
        raise FileNotFoundError(f'no decodable video frame in {src}') from e
    if im is None:
        raise FileNotFoundError(f'no decodable video frame in {src}')

    im = im.convert('RGB')
    im.thumbnail((size, size), Image.LANCZOS)
    _save_webp(im, dest)
    return dest


def resolve_thumb(view_url: str, max_edge: int) -> Path:
    src = view_url_to_path(view_url)
    if src is None:
        raise FileNotFoundError(view_url)
    return thumb_for_path(src, max_edge)


def thumb_for_path(src: Path, max_edge: int) -> Path:
    suffix = src.suffix.lower()
    if suffix in VIDEO_EXTS:
        return _video_thumb(src, snap_size(max_edge))
    if suffix not in IMAGE_EXTS:
        return src

    size = snap_size(max_edge)
    st = src.stat()
    key = hashlib.sha1(
        f'{src}|{st.st_size}|{st.st_mtime_ns}|{size}'.encode()).hexdigest()
    dest = thumb_dir() / f'{key}.webp'
    if dest.is_file():
        return dest

    from PIL import Image, ImageOps

    with Image.open(src) as im:
        if getattr(im, 'is_animated', False):
            return src
        if max(im.size) <= size * THUMB_SKIP_FACTOR:
            return src
        im = ImageOps.exif_transpose(im)
        has_alpha = ('A' in im.getbands()) or ('transparency' in im.info)
        im = im.convert('RGBA' if has_alpha else 'RGB')
        im.thumbnail((size, size), Image.LANCZOS)
        tmp = dest.with_name(f'{dest.stem}.{uuid.uuid4().hex[:8]}.tmp')
        im.save(tmp, format='webp', quality=THUMB_QUALITY)
    os.replace(tmp, dest)
    _prune_thumb_cache(dest)
    return dest


__all__ = ['resolve_thumb', 'thumb_for_path', 'snap_size', 'thumb_dir', 'THUMB_SIZES',
           'THUMB_SUBFOLDER', 'THUMB_SKIP_FACTOR', 'THUMB_QUALITY',
           'THUMB_MAX_FILES', 'THUMB_MAX_BYTES',
           'IMAGE_EXTS', 'VIDEO_EXTS']
