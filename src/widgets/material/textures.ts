import * as THREE from 'three'

import { MATERIAL_COLOR_MAP_KEYS, type MaterialMapKey } from './types'

const cache = new Map<string, THREE.Texture>()
const pending = new Map<string, Promise<THREE.Texture>>()

export type MaterialTextureKind = 'color' | 'data' | 'normal'

export interface LoadMaterialTextureOptions {
  kind?: MaterialTextureKind
  /**
   * Three.js default geometries (material ball) need `true`.
   * glTF / GLB meshes need `false` to match their UV convention.
   */
  flipY?: boolean
}

export function textureKindForMap(key: MaterialMapKey): MaterialTextureKind {
  if (key === 'normalMap') return 'normal'
  if (MATERIAL_COLOR_MAP_KEYS.has(key)) return 'color'
  return 'data'
}

function cacheKey(url: string, kind: MaterialTextureKind, flipY: boolean): string {
  return `${kind}\0${flipY ? '1' : '0'}\0${url}`
}

function colorSpaceFor(kind: MaterialTextureKind): THREE.ColorSpace {
  if (kind === 'color') return THREE.SRGBColorSpace
  return THREE.NoColorSpace
}

export function getCachedMaterialTexture(
  url: string,
  opts: LoadMaterialTextureOptions = {},
): THREE.Texture | null {
  const kind = opts.kind ?? 'color'
  const flipY = opts.flipY ?? true
  return cache.get(cacheKey(url, kind, flipY)) ?? null
}

export function loadMaterialTexture(
  url: string,
  opts: LoadMaterialTextureOptions | MaterialTextureKind = {},
): Promise<THREE.Texture> {
  // Back-compat: second arg used to be the kind string.
  const normalized: LoadMaterialTextureOptions =
    typeof opts === 'string' ? { kind: opts } : opts
  const kind = normalized.kind ?? 'color'
  const flipY = normalized.flipY ?? true
  const key = cacheKey(url, kind, flipY)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const inflight = pending.get(key)
  if (inflight) return inflight

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpaceFor(kind)
        tex.flipY = flipY
        tex.needsUpdate = true
        cache.set(key, tex)
        pending.delete(key)
        resolve(tex)
      },
      undefined,
      (err) => {
        pending.delete(key)
        reject(err)
      },
    )
  })
  pending.set(key, promise)
  return promise
}
