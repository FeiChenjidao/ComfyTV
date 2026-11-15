import * as THREE from 'three'

import {
  MATERIAL_MAP_KEYS,
  type MaterialMapKey,
  type MaterialScalarKey,
} from '@/widgets/material/types'

import { OVERLAY_FLAG, type ViewChannel } from './channelShading'

export type PreviewLighting = 'default' | 'studio' | 'dramatic' | 'flat'

export const PREVIEW_CHANNELS: ViewChannel[] = ['material', 'clay', 'wire', 'normal']
export const PREVIEW_LIGHTINGS: PreviewLighting[] = ['default', 'studio', 'dramatic', 'flat']

const CLONE_KEY = '__ctvPreviewClone'
const ORIG_MAPS_KEY = '__ctvPreviewOrigMaps'
const ORIG_SCALARS_KEY = '__ctvPreviewOrigScalars'
const ORIG_TRANSPARENT_KEY = '__ctvPreviewOrigTransparent'

const SCALAR_KEYS: MaterialScalarKey[] = [
  'metalness',
  'roughness',
  'transmission',
  'opacity',
  'clearcoat',
  'clearcoatRoughness',
  'ior',
  'emissiveIntensity',
  'normalScale',
  'aoMapIntensity',
]

export interface PreviewMaterialOverrides {
  maps?: Partial<Record<MaterialMapKey, THREE.Texture | null>>
  scalars?: Partial<Record<MaterialScalarKey, number | null>>
  /** When true, scalar values are multiplied onto each material's base value. */
  multiply?: boolean
}

export function invalidatePreviewMaterialClone(mesh: THREE.Mesh): void {
  if (mesh.userData[CLONE_KEY]) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) mat.dispose()
  }
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
      const maps = {} as Record<MaterialMapKey, THREE.Texture | null>
      for (const key of MATERIAL_MAP_KEYS) {
        maps[key] = (mat as unknown as Record<MaterialMapKey, THREE.Texture | null>)[key] ?? null
      }
      const scalars: Partial<Record<MaterialScalarKey, number>> = {}
      for (const key of SCALAR_KEYS) {
        const value = readScalar(mat, key)
        if (value !== undefined) scalars[key] = value
      }
      mat.userData[ORIG_MAPS_KEY] = maps
      mat.userData[ORIG_SCALARS_KEY] = scalars
      mat.userData[ORIG_TRANSPARENT_KEY] = mat.transparent
    }
  })
}

function readScalar(mat: THREE.MeshStandardMaterial, key: MaterialScalarKey): number | undefined {
  if (key === 'normalScale') return mat.normalScale.x
  const value = (mat as unknown as Record<MaterialScalarKey, unknown>)[key]
  return typeof value === 'number' ? value : undefined
}

function scalarLimit(key: MaterialScalarKey, value: number): number {
  if (key === 'ior') return Math.min(2.333, Math.max(1, value))
  if (key === 'normalScale' || key === 'aoMapIntensity') return Math.min(2, Math.max(0, value))
  if (key === 'emissiveIntensity') return Math.min(10, Math.max(0, value))
  return Math.min(1, Math.max(0, value))
}

function writeScalar(
  mat: THREE.MeshStandardMaterial,
  key: MaterialScalarKey,
  value: number,
): void {
  if (key === 'normalScale') {
    mat.normalScale.set(value, value)
    return
  }
  const record = mat as unknown as Record<MaterialScalarKey, unknown>
  if (typeof record[key] === 'number') record[key] = value
}

export function applyPreviewMaterialOverrides(
  root: THREE.Object3D,
  overrides: PreviewMaterialOverrides,
): void {
  ensurePreviewMaterialClones(root)
  const multiply = !!overrides.multiply
  eachStandardMat(root, (_mesh, mat) => {
    const originalMaps = mat.userData[ORIG_MAPS_KEY] as Record<MaterialMapKey, THREE.Texture | null>
    let mapsChanged = false
    for (const key of MATERIAL_MAP_KEYS) {
      if (!overrides.maps || overrides.maps[key] === undefined) continue
      const texture = overrides.maps[key] ?? originalMaps?.[key] ?? null
      ;(mat as unknown as Record<MaterialMapKey, THREE.Texture | null>)[key] = texture
      mapsChanged = true
    }

    const originalScalars = mat.userData[ORIG_SCALARS_KEY] as Partial<Record<MaterialScalarKey, number>>
    for (const key of SCALAR_KEYS) {
      const requested = overrides.scalars?.[key]
      if (requested === undefined) continue
      const base = originalScalars?.[key]
      if (base === undefined) continue
      const value = requested == null ? base : (multiply ? base * requested : requested)
      writeScalar(mat, key, scalarLimit(key, value))
    }

    const originalTransparent = !!mat.userData[ORIG_TRANSPARENT_KEY]
    mat.transparent = originalTransparent || mat.opacity < 1 || !!mat.alphaMap
    if (mapsChanged) mat.needsUpdate = true
  })
}

export function clearPreviewMaterialClones(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.userData[CLONE_KEY]) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const mat of mats) mat.dispose()
    delete child.userData[CLONE_KEY]
  })
}

export function loadTextureFromFile(
  file: File,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        URL.revokeObjectURL(url)
        tex.colorSpace = colorSpace
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
