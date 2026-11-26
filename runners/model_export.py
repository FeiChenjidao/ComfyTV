"""Convert source polygon files in Blender, without a preview-mesh round trip."""

from io import BytesIO
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

from ._media_paths import view_url_to_path


def blender_executable() -> str:
    configured = os.environ.get('COMFYTV_BLENDER_PATH')
    if configured:
        if not Path(configured).is_file():
            raise RuntimeError('COMFYTV_BLENDER_PATH does not point to a Blender executable')
        return configured
    installed = shutil.which('blender')
    if installed:
        return installed
    candidates = []
    local = os.environ.get('LOCALAPPDATA')
    if local:
        candidates.extend((Path(local) / 'ComfyTV/tools').glob('blender-*/blender.exe'))
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)'):
        directory = os.environ.get(variable)
        if directory:
            candidates.extend((Path(directory) / 'Blender Foundation').glob('Blender */blender.exe'))
    if candidates:
        return str(sorted(candidates)[-1])
    raise RuntimeError('Install Blender 4.2 or newer and set COMFYTV_BLENDER_PATH to preserve source polygons when converting FBX/OBJ')


def export_source_model(url: str, format_: str) -> tuple[bytes, str, str]:
    if format_ not in ('fbx', 'obj'):
        raise ValueError('Source polygon export supports FBX and OBJ')
    source = view_url_to_path(url)
    if source is None:
        raise FileNotFoundError('Source model not found')
    if source.suffix.lower() not in ('.fbx', '.obj'):
        raise ValueError('Source model must be FBX or OBJ')
    stem = re.sub(r'[\s\\/:*?"<>|\x00-\x1f]', '_', source.stem) or 'model'
    if source.suffix.lower() == '.fbx' and format_ == 'fbx':
        return source.read_bytes(), stem + '.fbx', 'application/octet-stream'
    executable = blender_executable()
    script = Path(__file__).with_name('_blender_model_export.py')
    with tempfile.TemporaryDirectory(prefix='comfytv-model-export-') as directory:
        destination = Path(directory) / f'{stem}.{format_}'
        result = subprocess.run([
            executable, '--background', '--factory-startup', '--disable-autoexec',
            '--python-exit-code', '1', '--python', str(script), '--', str(source), str(destination),
        ], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode or not destination.is_file():
            raise RuntimeError('Source model export failed: ' + (result.stderr or result.stdout)[-2000:])
        output = BytesIO()
        with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
            for path in sorted(Path(directory).rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(directory).as_posix())
        return output.getvalue(), f'{stem}_{format_}.zip', 'application/zip'
