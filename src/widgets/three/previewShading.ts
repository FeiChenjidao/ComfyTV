import * as THREE from 'three'

import { OVERLAY_FLAG, type ViewChannel } from './channelShading'

export type PreviewLighting = 'default' | 'studio' | 'dramatic' | 'flat'

export const PREVIEW_CHANNELS: ViewChannel[] = ['material', 'clay', 'wire', 'normal']
export const PREVIEW_LIGHTINGS: PreviewLighting[] = ['default', 'studio', 'dramatic', 'flat']

const CLONE_KEY = '__ctvPreviewClone'
const ORIG_MAP_KEY = '__ctvPreviewOrigMap'
const ORIG_METAL_KEY = '__ctvPreviewOrigMetal'
const ORIG_ROUGH_KEY = '__ctvPreviewOrigRough'

export interface PreviewMaterialOverrides {
  map?: THREE.Texture | null
  metalness?: number | null
  roughness?: number | null
  /** When true, metalness/roughness are multiplied onto the cloned base values. */
  multiply?: boolean
}

export function invalidatePreviewMaterialClone(mesh: THREE.Mesh): void {
  delete mesh.userData[CLONE_KEY]
}

function eachStandardMat(
  root: THREE.Object3D,
  fn: (mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial) => void,
): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.userData[OVERLAY_FLAG]) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of mats) {
      if (mat instanceof THREE.MeshStandardMaterial) fn(child, mat)
    }
  })
}

/** Ensure each mesh uses a disposable clone so we never mutate the asset's materials. */
export function ensurePreviewMaterialClones(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.userData[OVERLAY_FLAG]) return
    if (child.userData[CLONE_KEY]) return
    const src = child.material
    if (Array.isArray(src)) {
      child.material = src.map((m) => m.clone())
    } else {
      child.material = src.clone()
    }
    child.userData[CLONE_KEY] = true
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue
      mat.userData[ORIG_MAP_KEY] = mat.map ?? null
      mat.userData[ORIG_METAL_KEY] = mat.metalness
      mat.userData[ORIG_ROUGH_KEY] = mat.roughness
    }
  })
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function applyPreviewMaterialOverrides(
  root: THREE.Object3D,
  overrides: PreviewMaterialOverrides,
): void {
  ensurePreviewMaterialClones(root)
  const multiply = !!overrides.multiply
  eachStandardMat(root, (_mesh, mat) => {
    if (overrides.map !== undefined) {
      mat.map = overrides.map ?? (mat.userData[ORIG_MAP_KEY] as THREE.Texture | null) ?? null
      mat.needsUpdate = true
    }
    if (overrides.metalness != null) {
      const base = (mat.userData[ORIG_METAL_KEY] as number | undefined) ?? mat.metalness
      mat.metalness = multiply ? clamp01(base * overrides.metalness) : overrides.metalness
    } else if (ORIG_METAL_KEY in mat.userData) {
      mat.metalness = mat.userData[ORIG_METAL_KEY] as number
    }
    if (overrides.roughness != null) {
      const base = (mat.userData[ORIG_ROUGH_KEY] as number | undefined) ?? mat.roughness
      mat.roughness = multiply ? clamp01(base * overrides.roughness) : overrides.roughness
    } else if (ORIG_ROUGH_KEY in mat.userData) {
      mat.roughness = mat.userData[ORIG_ROUGH_KEY] as number
    }
  })
}

export function clearPreviewMaterialClones(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.userData[CLONE_KEY]) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of mats) {
      // Only dispose clones we created — original maps stay owned by the loader.
      if (mat.userData[ORIG_MAP_KEY] !== undefined && mat.map && mat.map !== mat.userData[ORIG_MAP_KEY]) {
        // Custom override textures are disposed by the caller.
      }
      mat.dispose()
    }
    delete child.userData[CLONE_KEY]
  })
}

export function loadTextureFromFile(file: File): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        URL.revokeObjectURL(url)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = false
        tex.needsUpdate = true
        resolve(tex)
      },
      undefined,
      (err) => {
        URL.revokeObjectURL(url)
        reject(err)
      },
    )
  })
}

export function loadTextureFromUrl(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = false
        tex.needsUpdate = true
        resolve(tex)
      },
      undefined,
      reject,
    )
  })
}

export function buildPreviewLights(mode: PreviewLighting): THREE.Light[] {
  const lights: THREE.Light[] = []
  if (mode === 'flat') {
    lights.push(new THREE.AmbientLight(0xffffff, 1.2))
    return lights
  }
  if (mode === 'studio') {
    lights.push(new THREE.AmbientLight(0xffffff, 0.45))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(2, 3, 2)
    lights.push(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.7)
    fill.position.set(-2.5, 2, 2)
    lights.push(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 1.4)
    rim.position.set(0, 3, -3)
    lights.push(rim)
    return lights
  }
  if (mode === 'dramatic') {
    lights.push(new THREE.AmbientLight(0xffffff, 0.15))
    const key = new THREE.DirectionalLight(0xfff0e0, 2.6)
    key.position.set(2.2, 2.5, 1.2)
    lights.push(key)
    const rim = new THREE.DirectionalLight(0xa0c0ff, 1.8)
    rim.position.set(-1.5, 1.5, -3)
    lights.push(rim)
    return lights
  }
  // default
  lights.push(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(3, 5, 4)
  lights.push(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-4, 2, -3)
  lights.push(fill)
  return lights
}

export function replaceSceneLights(scene: THREE.Scene, mode: PreviewLighting): THREE.Light[] {
  const remove: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if (obj instanceof THREE.Light && obj.userData.__ctvPreviewLight) remove.push(obj)
  })
  for (const obj of remove) scene.remove(obj)

  const lights = buildPreviewLights(mode)
  for (const light of lights) {
    light.userData.__ctvPreviewLight = true
    scene.add(light)
  }
  return lights
}
