import type * as THREE from 'three'

import { applyMaterialParams, type MaterialTextureBag } from './three'
import {
  getCachedMaterialTexture,
  loadMaterialTexture,
  textureKindForMap,
} from './textures'
import { MATERIAL_MAP_KEYS, type MaterialMapKey, type MaterialParams } from './types'

export interface ApplyMaterialMapsOptions {
  /**
   * `true` for Three.js built-in geometries (material ball).
   * `false` for glTF / GLB meshes.
   */
  flipY?: boolean
}

export function collectMaterialTextures(
  p: MaterialParams,
  opts: ApplyMaterialMapsOptions = {},
): {
  textures: MaterialTextureBag
  missing: { key: MaterialMapKey; url: string }[]
} {
  const flipY = opts.flipY ?? true
  const textures: MaterialTextureBag = {}
  const missing: { key: MaterialMapKey; url: string }[] = []
  for (const key of MATERIAL_MAP_KEYS) {
    const url = p[key]
    if (!url) {
      textures[key] = null
      continue
    }
    const kind = textureKindForMap(key)
    const cached = getCachedMaterialTexture(url, { kind, flipY })
    // Leave uncached slots undefined so applyMaterialParams does not wipe maps
    // that are still loading (or already applied on a concurrent pass).
    if (cached) textures[key] = cached
    else missing.push({ key, url })
  }
  return { textures, missing }
}

export function applyMaterialWithMaps(
  mat: THREE.MeshPhysicalMaterial,
  p: MaterialParams,
  opts: ApplyMaterialMapsOptions = {},
): { missing: { key: MaterialMapKey; url: string }[] } {
  const { textures, missing } = collectMaterialTextures(p, opts)
  applyMaterialParams(mat, p, textures)
  return { missing }
}

export async function loadMissingMaterialMaps(
  p: MaterialParams,
  missing: { key: MaterialMapKey; url: string }[],
  stillValid: () => boolean,
  onReady: () => void,
  opts: ApplyMaterialMapsOptions = {},
): Promise<void> {
  const flipY = opts.flipY ?? true
  await Promise.all(missing.map(async ({ key, url }) => {
    try {
      await loadMaterialTexture(url, { kind: textureKindForMap(key), flipY })
    } catch (e) {
      console.error('[ComfyTV/material] map load failed', key, url, e)
    }
  }))
  if (!stillValid()) return
  onReady()
}
