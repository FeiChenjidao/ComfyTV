import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  applyPreviewMaterialOverrides,
  buildPreviewLights,
  ensurePreviewMaterialClones,
  PREVIEW_CHANNELS,
  PREVIEW_LIGHTINGS,
  replaceSceneLights,
} from './previewShading'

describe('previewShading', () => {
  it('exposes the expected channel and lighting presets', () => {
    expect(PREVIEW_CHANNELS).toEqual(['material', 'clay', 'wire', 'normal'])
    expect(PREVIEW_LIGHTINGS).toEqual(['default', 'studio', 'dramatic', 'flat'])
  })

  it('builds lights for each lighting mode', () => {
    expect(buildPreviewLights('flat')).toHaveLength(1)
    expect(buildPreviewLights('default').length).toBeGreaterThanOrEqual(2)
    expect(buildPreviewLights('studio').length).toBeGreaterThanOrEqual(3)
    expect(buildPreviewLights('dramatic').length).toBeGreaterThanOrEqual(2)
  })

  it('replaceSceneLights swaps tagged lights on the scene', () => {
    const scene = new THREE.Scene()
    const first = replaceSceneLights(scene, 'default')
    expect(scene.children.filter((c) => c instanceof THREE.Light)).toHaveLength(first.length)
    const second = replaceSceneLights(scene, 'flat')
    expect(scene.children.filter((c) => c instanceof THREE.Light)).toHaveLength(second.length)
    expect(second).toHaveLength(1)
  })

  it('clones materials and applies metalness/roughness overrides', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.8 }),
    )
    const root = new THREE.Group()
    root.add(mesh)

    ensurePreviewMaterialClones(root)
    expect(mesh.userData.__ctvPreviewClone).toBe(true)
    expect(mesh.material).not.toBeUndefined()

    applyPreviewMaterialOverrides(root, { metalness: 0.9, roughness: 0.2 })
    const mat = mesh.material as THREE.MeshStandardMaterial
    expect(mat.metalness).toBe(0.9)
    expect(mat.roughness).toBe(0.2)
  })

  it('multiplies metalness/roughness onto the cloned base values', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.8 }),
    )
    const root = new THREE.Group()
    root.add(mesh)

    applyPreviewMaterialOverrides(root, { metalness: 0.5, roughness: 0.5, multiply: true })
    const mat = mesh.material as THREE.MeshStandardMaterial
    expect(mat.metalness).toBeCloseTo(0.25)
    expect(mat.roughness).toBeCloseTo(0.4)

    // Re-applying uses the stored base, so it does not compound.
    applyPreviewMaterialOverrides(root, { metalness: 1, roughness: 1, multiply: true })
    expect(mat.metalness).toBeCloseTo(0.5)
    expect(mat.roughness).toBeCloseTo(0.8)
  })

  it('applies a texture map override', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    )
    const root = new THREE.Group()
    root.add(mesh)
    const tex = new THREE.Texture()
    applyPreviewMaterialOverrides(root, { map: tex })
    expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(tex)
  })
})
