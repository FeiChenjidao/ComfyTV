"""Run with Blender's Python: source FBX/OBJ -> polygon-preserving FBX/OBJ."""

from collections import Counter
import json
from pathlib import Path
import re
import shutil
import sys

import bpy


def load(path):
    if path.suffix.lower() == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(path), use_image_search=False)
    else:
        bpy.ops.wm.obj_import(filepath=str(path))


def face_counts():
    return Counter(len(polygon.vertices) for obj in bpy.context.scene.objects
                   if obj.type == 'MESH' for polygon in obj.data.polygons)


def save_textures(source, destination):
    textures = destination.parent / 'textures'
    for index, image in enumerate(bpy.data.images):
        if image.source != 'FILE':
            continue
        original = Path(bpy.path.abspath(image.filepath)).resolve()
        packed = image.packed_file
        if not packed and not original.is_relative_to(source.parent):
            raise ValueError('Texture must stay inside the source model directory: ' + image.name)
        if not packed and not original.is_file():
            raise FileNotFoundError('Texture not found: ' + image.name)
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', original.name) or 'texture.png'
        if packed:
            data = bytes(packed.data)
            if data.startswith(b'\x89PNG'):
                name = Path(name).stem + '.png'
            elif data.startswith(b'\xff\xd8'):
                name = Path(name).stem + '.jpg'
        textures.mkdir(exist_ok=True)
        target = textures / f'{index}_{name}'
        if packed:
            target.write_bytes(data)
        else:
            shutil.copyfile(original, target)
        image.filepath = str(target)
    materials = []
    for material in bpy.data.materials:
        maps = {}
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    filename = Path(bpy.path.abspath(node.image.filepath))
                    if filename.is_relative_to(destination.parent):
                        maps[node.label or node.name] = filename.relative_to(destination.parent).as_posix()
        materials.append(dict(name=material.name, color=list(material.diffuse_color),
                              metalness=material.metallic, roughness=material.roughness, maps=maps))
    (destination.parent / 'materials.json').write_text(
        json.dumps(materials, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    source, destination = [Path(value).resolve() for value in sys.argv[sys.argv.index('--') + 1:]]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load(source)
    expected = face_counts()
    if not expected:
        raise ValueError('Source model contains no polygon meshes')
    save_textures(source, destination)
    if destination.suffix == '.fbx':
        bpy.ops.export_scene.fbx(
            filepath=str(destination), use_mesh_modifiers=False, use_triangles=False,
            path_mode='COPY', embed_textures=True, add_leaf_bones=False)
    else:
        bpy.ops.wm.obj_export(
            filepath=str(destination), apply_modifiers=False, export_triangulated_mesh=False,
            export_uv=True, export_normals=True, export_materials=True,
            export_pbr_extensions=True, path_mode='RELATIVE')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load(destination)
    actual = face_counts()
    if actual != expected:
        raise ValueError(f'Export changed polygon types: {dict(expected)} -> {dict(actual)}')


if __name__ == '__main__':
    main()
