import * as THREE from 'three'

import type { MaterialMapKey, MaterialParams } from './types'

export type MaterialTextureBag = {
  [K in MaterialMapKey]?: THREE.Texture | null
}

export function applyMaterialParams(
  mat: THREE.MeshPhysicalMaterial,
  p: MaterialParams,
  textures?: MaterialTextureBag,
): void {
  mat.color.set(p.color)
  mat.metalness = p.metalness
  mat.roughness = p.roughness
  mat.transmission = p.transmission
  mat.opacity = p.opacity
  mat.transparent = p.opacity < 1 || !!p.alphaMap
  mat.clearcoat = p.clearcoat
  mat.clearcoatRoughness = p.clearcoatRoughness
  mat.ior = p.ior
  mat.emissive.set(p.emissive)
  mat.emissiveIntensity = p.emissiveIntensity
  mat.normalScale.set(p.normalScale, p.normalScale)
  mat.aoMapIntensity = p.aoMapIntensity

  if (!textures) return

  let touched = false
  const assign = (prop: MaterialMapKey, value: THREE.Texture | null | undefined): void => {
    if (value === undefined) return
    ;(mat as unknown as Record<string, THREE.Texture | null>)[prop] = value
    touched = true
  }

  assign('map', textures.map)
  assign('metalnessMap', textures.metalnessMap)
  assign('roughnessMap', textures.roughnessMap)
  assign('normalMap', textures.normalMap)
  assign('emissiveMap', textures.emissiveMap)
  assign('alphaMap', textures.alphaMap)
  assign('aoMap', textures.aoMap)
  assign('transmissionMap', textures.transmissionMap)
  assign('clearcoatMap', textures.clearcoatMap)
  assign('clearcoatRoughnessMap', textures.clearcoatRoughnessMap)

  if (touched) mat.needsUpdate = true
}

/** Resolve cached textures for every map URL on the material; missing entries stay undefined. */
export function resolveMaterialTextures(
  p: MaterialParams,
  getCached: (url: string, kind: 'color' | 'data' | 'normal') => THREE.Texture | null,
  kindFor: (key: MaterialMapKey) => 'color' | 'data' | 'normal',
): MaterialTextureBag {
  const out: MaterialTextureBag = {}
  const keys: MaterialMapKey[] = [
    'map', 'metalnessMap', 'roughnessMap', 'normalMap', 'emissiveMap',
    'alphaMap', 'aoMap', 'transmissionMap', 'clearcoatMap', 'clearcoatRoughnessMap',
  ]
  for (const key of keys) {
    const url = p[key]
    out[key] = url ? getCached(url, kindFor(key)) : null
  }
  return out
}
