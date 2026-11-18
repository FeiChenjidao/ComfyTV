import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  convertModelFileToGlb,
  isConvertibleModelFile,
  isModelResourceFile,
} from './convertToGlb'

describe('convertToGlb', () => {
  it('recognizes FBX, OBJ, and common sidecar resources case-insensitively', () => {
    expect(isConvertibleModelFile('CHARACTER.FBX')).toBe(true)
    expect(isConvertibleModelFile('mesh.OBJ')).toBe(true)
    expect(isModelResourceFile('mesh.MTL')).toBe(true)
    expect(isModelResourceFile('ALBEDO.PNG')).toBe(true)
  })

  it('converts an OBJ with a matching MTL file to GLB', async () => {
    const obj = new File([
      'mtllib mesh.mtl\n',
      'o Triangle\n',
      'v 0 0 0\n',
      'v 1 0 0\n',
      'v 0 1 0\n',
      'usemtl Surface\n',
      'f 1 2 3\n',
    ], 'mesh.obj')
    const mtl = new File([
      'newmtl Surface\n',
      'Kd 0.8 0.2 0.1\n',
    ], 'mesh.mtl')

    const glb = await convertModelFileToGlb(obj, [obj, mtl])

    expect(glb.name).toBe('mesh.glb')
    expect(glb.type).toBe('model/gltf-binary')
    expect(glb.size).toBeGreaterThan(20)
  })

  it('converts a binary FBX upload to GLB', async () => {
    const scene = new THREE.Group()
    scene.add(new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x6699cc }),
    ))
    const bytes = await new FBXExporter().parseAsync(scene, { embedTextures: false })
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const fbx = new File([buffer], 'box.fbx')

    const glb = await convertModelFileToGlb(fbx, [fbx])

    expect(glb.name).toBe('box.glb')
    expect(glb.size).toBeGreaterThan(20)
  })
})
