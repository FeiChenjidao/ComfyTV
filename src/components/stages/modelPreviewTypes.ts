import type { MaterialMapKey, MaterialScalarKey } from '@/widgets/material/types'

export type PreviewPbrKey = Exclude<MaterialScalarKey, 'ior'>

export type PreviewPbrState = Record<PreviewPbrKey, number>

export interface PreviewMapSlot {
  key: MaterialMapKey
  previewUrl: string | null
  source: 'custom' | 'embedded' | 'empty'
  count: number
  fileName?: string
}

export interface ModelViewerStats {
  vertices: number
  triangles: number
  meshes: number
  materials: number
  size: [number, number, number]
}

export const DEFAULT_PREVIEW_PBR: PreviewPbrState = {
  metalness: 1,
  roughness: 1,
  transmission: 1,
  opacity: 1,
  clearcoat: 1,
  clearcoatRoughness: 1,
  emissiveIntensity: 1,
  normalScale: 1,
  aoMapIntensity: 1,
}

export const PREVIEW_PBR_RANGES: Record<
  PreviewPbrKey,
  { min: number; max: number; step: number }
> = {
  metalness: { min: 0, max: 2, step: 0.01 },
  roughness: { min: 0, max: 2, step: 0.01 },
  transmission: { min: 0, max: 2, step: 0.01 },
  opacity: { min: 0, max: 1, step: 0.01 },
  clearcoat: { min: 0, max: 2, step: 0.01 },
  clearcoatRoughness: { min: 0, max: 2, step: 0.01 },
  emissiveIntensity: { min: 0, max: 4, step: 0.01 },
  normalScale: { min: 0, max: 2, step: 0.01 },
  aoMapIntensity: { min: 0, max: 2, step: 0.01 },
}
