import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { applyViewChannel } from './channelShading'

describe('channelShading', () => {
  it('keeps geometry normals as the default normal preview', () => {
    const original = new THREE.MeshStandardMaterial()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original)

    applyViewChannel(mesh, 'normal')

    expect(mesh.material).toBeInstanceOf(THREE.MeshNormalMaterial)
    applyViewChannel(mesh, 'material')
    expect(mesh.material).toBe(original)
  })

  it('previews the active normal map on a neutral lit material', () => {
    const normalMap = new THREE.Texture()
    const original = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      map: new THREE.Texture(),
      normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughness: 0.1,
      metalness: 1,
    })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original)

    applyViewChannel(mesh, 'normal', { normalMode: 'texture' })

    const preview = mesh.material as THREE.MeshStandardMaterial
    expect(preview).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(preview).not.toBe(original)
    expect(preview.map).toBeNull()
    expect(preview.normalMap).toBe(normalMap)
    expect(preview.normalScale.x).toBeCloseTo(1.4)
    expect(preview.metalness).toBe(0)

    const dispose = vi.spyOn(preview, 'dispose')
    applyViewChannel(mesh, 'material')
    expect(dispose).toHaveBeenCalledOnce()
    expect(mesh.material).toBe(original)
  })
})
