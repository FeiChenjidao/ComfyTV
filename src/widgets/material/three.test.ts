import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { applyMaterialParams } from './three'
import { DEFAULT_MATERIAL, type MaterialParams } from './types'

function makeParams(overrides: Partial<MaterialParams> = {}): MaterialParams {
  return { ...DEFAULT_MATERIAL, ...overrides }
}

describe('applyMaterialParams', () => {
  it('copies every scalar param onto the material', () => {
    const mat = new THREE.MeshPhysicalMaterial()
    applyMaterialParams(mat, makeParams({
      metalness: 0.7,
      roughness: 0.2,
      transmission: 0.3,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
      ior: 1.8,
      emissiveIntensity: 2,
      normalScale: 1.5,
      aoMapIntensity: 0.6,
    }))
    expect(mat.metalness).toBe(0.7)
    expect(mat.roughness).toBe(0.2)
    expect(mat.transmission).toBe(0.3)
    expect(mat.clearcoat).toBe(0.5)
    expect(mat.clearcoatRoughness).toBe(0.25)
    expect(mat.ior).toBe(1.8)
    expect(mat.emissiveIntensity).toBe(2)
    expect(mat.normalScale.x).toBe(1.5)
    expect(mat.aoMapIntensity).toBe(0.6)
  })

  it('sets color and emissive from hex strings', () => {
    const mat = new THREE.MeshPhysicalMaterial()
    applyMaterialParams(mat, makeParams({ color: '#ff0000', emissive: '#00ff00' }))
    expect(mat.color.getHexString()).toBe('ff0000')
    expect(mat.emissive.getHexString()).toBe('00ff00')
  })

  it('marks the material transparent when opacity < 1', () => {
    const mat = new THREE.MeshPhysicalMaterial()
    applyMaterialParams(mat, makeParams({ opacity: 0.5 }))
    expect(mat.opacity).toBe(0.5)
    expect(mat.transparent).toBe(true)
  })

  it('keeps the material opaque at opacity 1', () => {
    const mat = new THREE.MeshPhysicalMaterial()
    mat.transparent = true
    applyMaterialParams(mat, makeParams({ opacity: 1 }))
    expect(mat.opacity).toBe(1)
    expect(mat.transparent).toBe(false)
  })

  it('assigns or clears channel maps when provided', () => {
    const mat = new THREE.MeshPhysicalMaterial()
    const albedo = new THREE.Texture()
    const metal = new THREE.Texture()
    const normal = new THREE.Texture()
    applyMaterialParams(mat, makeParams(), {
      map: albedo,
      metalnessMap: metal,
      normalMap: normal,
    })
    expect(mat.map).toBe(albedo)
    expect(mat.metalnessMap).toBe(metal)
    expect(mat.normalMap).toBe(normal)
    applyMaterialParams(mat, makeParams(), { map: null, metalnessMap: null, normalMap: null })
    expect(mat.map).toBeNull()
    expect(mat.metalnessMap).toBeNull()
    expect(mat.normalMap).toBeNull()
  })
})
