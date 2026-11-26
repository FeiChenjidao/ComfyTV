from collections import Counter
from io import BytesIO
from pathlib import Path
import json
import struct
import subprocess
from zipfile import ZipFile

from PIL import Image
import pytest

import folder_paths
from ComfyTV.runners import model_export as export


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_paths, 'get_directory_by_type', lambda kind: str(tmp_path))
    path = tmp_path / 'mixed.obj'
    path.write_text('''mtllib mixed.mtl
o Mixed
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v -1 0.5 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vt -1 0.5
vn 0 0 1
usemtl Red
f 1/1/1 2/2/1 3/3/1
usemtl Blue
f 1/1/1 2/2/1 3/3/1 4/4/1
f 1/1/1 2/2/1 3/3/1 4/4/1 5/5/1
''')
    (tmp_path / 'mixed.mtl').write_text('''newmtl Red
Kd 1 0 0
map_Kd albedo.png
newmtl Blue
Kd 0 0 1
Pr 0.3
Pm 0.7
''')
    Image.new('RGB', (2, 2), 'red').save(tmp_path / 'albedo.png')
    return path


@pytest.fixture
def blender():
    try:
        return export.blender_executable()
    except RuntimeError as error:
        pytest.skip(str(error))


def _export_file(source, format_):
    relative = source.relative_to(Path(folder_paths.get_directory_by_type('output'))).as_posix()
    data, name, mime = export.export_source_model(f'/view?filename={relative}&type=output', format_)
    assert mime == 'application/zip'
    assert name.endswith(f'_{format_}.zip')
    with ZipFile(BytesIO(data)) as archive:
        archive.extractall(source.parent / ('export_' + format_))
        path = source.parent / ('export_' + format_) / (source.stem + '.' + format_)
        return path, set(archive.namelist())


def _obj_faces(path):
    positions, uvs, faces = [], [], []
    for line in path.read_text().splitlines():
        values = line.split()
        if not values:
            continue
        if values[0] == 'v':
            positions.append(tuple(round(float(v), 5) for v in values[1:4]))
        elif values[0] == 'vt':
            uvs.append(tuple(round(float(v), 5) for v in values[1:3]))
        elif values[0] == 'f':
            face = []
            for corner in values[1:]:
                v, uv, *_ = corner.split('/')
                face.append((positions[int(v) - 1], uvs[int(uv) - 1]))
            # Exporters can rotate a polygon's first corner, but must keep its winding and UV seams.
            faces.append(min(tuple(face[i:] + face[:i]) for i in range(len(face))))
    return Counter(faces)


def test_obj_fbx_obj_preserves_polygons_uvs_materials_and_textures(source, blender):
    fbx, files = _export_file(source, 'fbx')
    assert any(name.startswith('textures/') for name in files)
    original_texture = (source.parent / 'albedo.png').read_bytes()
    assert any(path.read_bytes() == original_texture for path in fbx.parent.rglob('*.png'))
    obj, files = _export_file(fbx, 'obj')
    assert _obj_faces(obj) == _obj_faces(source)
    mtl = obj.with_suffix('.mtl').read_text()
    assert 'map_Kd' in mtl
    assert 'Red' in mtl and 'Blue' in mtl
    assert 'materials.json' in files
    assert any(path.read_bytes() == original_texture for path in obj.parent.rglob('*.png'))


def test_obj_to_obj_keeps_faces(source, blender):
    obj, _ = _export_file(source, 'obj')
    assert _obj_faces(obj) == _obj_faces(source)


def test_fbx_pbr_preview_embeds_maps_without_changing_source(source, blender):
    mtl = source.with_suffix('.mtl')
    mtl.write_text(mtl.read_text().replace('map_Kd albedo.png',
                   'map_Kd albedo.png\nmap_Pr roughness.png\nmap_Pm metallic.png\nmap_Bump normal.png'))
    for name, color in [('roughness', (120, 120, 120)), ('metallic', (200, 200, 200)),
                        ('normal', (128, 128, 255))]:
        Image.new('RGB', (2, 2), color).save(source.parent / (name + '.png'))
    fbx, _ = _export_file(source, 'fbx')
    before = fbx.read_bytes()
    relative = fbx.relative_to(Path(folder_paths.get_directory_by_type('output'))).as_posix()
    preview = export.preview_fbx_model(f'/view?filename={relative}&type=output')
    length = struct.unpack_from('<I', preview, 12)[0]
    document = json.loads(preview[20:20 + length])
    red = next(material for material in document['materials'] if material['name'] == 'Red')
    assert 'baseColorTexture' in red['pbrMetallicRoughness']
    assert 'metallicRoughnessTexture' in red['pbrMetallicRoughness']
    assert 'normalTexture' in red
    assert all('bufferView' in image for image in document['images'])
    assert fbx.read_bytes() == before


@pytest.mark.parametrize('size', [3, 4])
def test_pure_triangles_or_quads_remain_the_same_in_both_formats(source, blender, size):
    lines = source.read_text().splitlines()
    source.write_text('\n'.join(line for line in lines
                                if not line.startswith('f ') or len(line.split()) - 1 == size) + '\n')
    fbx, _ = _export_file(source, 'fbx')
    obj, _ = _export_file(fbx, 'obj')
    assert _obj_faces(obj) == _obj_faces(source)


def test_fbx_same_format_is_byte_identical(source):
    path = source.with_suffix('.fbx')
    path.write_bytes(b'original quad FBX')
    data, name, mime = export.export_source_model('/view?filename=mixed.fbx', 'fbx')
    assert data == path.read_bytes()
    assert name == 'mixed.fbx' and mime == 'application/octet-stream'


def test_never_falls_back_to_preview_on_blender_error(source, monkeypatch):
    monkeypatch.setattr(export, 'blender_executable', lambda: 'blender')
    monkeypatch.setattr(export.subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess(a[0], 1, '', 'conversion failed'))
    with pytest.raises(RuntimeError, match='conversion failed'):
        export.export_source_model('/view?filename=mixed.obj', 'fbx')


def test_source_path_is_confined(source):
    with pytest.raises(ValueError, match='escapes'):
        export.export_source_model('/view?filename=../private.fbx', 'obj')
    with pytest.raises(FileNotFoundError):
        export.export_source_model('https://example.com/private.fbx', 'obj')


def test_rejects_unsupported_formats(source):
    with pytest.raises(ValueError, match='FBX and OBJ'):
        export.export_source_model('/view?filename=mixed.obj', 'glb')


@pytest.mark.asyncio
async def test_source_download_endpoint_preserves_unicode_filename(monkeypatch):
    from ComfyTV.api import model_export as api
    from types import SimpleNamespace
    monkeypatch.setattr(api, 'export_source_model', lambda *args: (b'zip', '模型_obj.zip', 'application/zip'))
    response = await api.export_source(SimpleNamespace(query={'url': '/view?filename=a.fbx', 'format': 'obj'}))
    assert response.body == b'zip'
    assert "filename*=UTF-8''%E6%A8%A1%E5%9E%8B_obj.zip" in response.headers['Content-Disposition']


@pytest.mark.asyncio
async def test_fbx_preview_endpoint_returns_embedded_glb(monkeypatch):
    from ComfyTV.api import model_export as api
    from types import SimpleNamespace
    monkeypatch.setattr(api, 'preview_fbx_model', lambda url: b'glTF preview bytes')
    response = await api.preview_fbx(SimpleNamespace(query={'url': '/view?filename=model.fbx'}))
    assert response.body == b'glTF preview bytes'
    assert response.content_type == 'model/gltf-binary'
    assert response.headers['Cache-Control'] == 'no-store'
