export const MATERIAL_MAP_KEYS = [
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'emissiveMap',
  'alphaMap',
  'aoMap',
  'transmissionMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
] as const

export type MaterialMapKey = (typeof MATERIAL_MAP_KEYS)[number]

/** Maps whose samples are treated as colour (sRGB). Others are linear data / normals. */
export const MATERIAL_COLOR_MAP_KEYS = new Set<MaterialMapKey>(['map', 'emissiveMap'])

export interface MaterialParams {
  version: 1
  color: string
  metalness: number
  roughness: number
  transmission: number
  opacity: number
  clearcoat: number
  clearcoatRoughness: number
  ior: number
  emissive: string
  emissiveIntensity: number
  /** Albedo / base-color texture URL. Multiplies `color`. */
  map: string | null
  /** Grayscale metalness texture. Multiplies `metalness`. */
  metalnessMap: string | null
  /** Grayscale roughness texture. Multiplies `roughness`. */
  roughnessMap: string | null
  /** Tangent-space normal map. */
  normalMap: string | null
  /** Strength of `normalMap` (0–2). */
  normalScale: number
  /** Emissive texture. Multiplies `emissive`. */
  emissiveMap: string | null
  /** Grayscale alpha texture. Multiplies `opacity`. */
  alphaMap: string | null
  /** Ambient occlusion texture. */
  aoMap: string | null
  aoMapIntensity: number
  /** Grayscale transmission texture. Multiplies `transmission`. */
  transmissionMap: string | null
  clearcoatMap: string | null
  clearcoatRoughnessMap: string | null
}

export type MaterialScalarKey =
  | 'metalness'
  | 'roughness'
  | 'transmission'
  | 'opacity'
  | 'clearcoat'
  | 'clearcoatRoughness'
  | 'ior'
  | 'emissiveIntensity'
  | 'normalScale'
  | 'aoMapIntensity'

/** Which texture multiplies which scalar (Three.js convention). */
export const MATERIAL_SCALAR_MAP: Partial<Record<MaterialScalarKey, MaterialMapKey>> = {
  metalness: 'metalnessMap',
  roughness: 'roughnessMap',
  transmission: 'transmissionMap',
  opacity: 'alphaMap',
  clearcoat: 'clearcoatMap',
  clearcoatRoughness: 'clearcoatRoughnessMap',
}

export const DEFAULT_MATERIAL: MaterialParams = {
  version: 1,
  color: '#8fbf8f',
  metalness: 0,
  roughness: 0.4,
  transmission: 0,
  opacity: 1,
  clearcoat: 0,
  clearcoatRoughness: 0.1,
  ior: 1.5,
  emissive: '#000000',
  emissiveIntensity: 0,
  map: null,
  metalnessMap: null,
  roughnessMap: null,
  normalMap: null,
  normalScale: 1,
  emissiveMap: null,
  alphaMap: null,
  aoMap: null,
  aoMapIntensity: 1,
  transmissionMap: null,
  clearcoatMap: null,
  clearcoatRoughnessMap: null,
}

type PresetOmit = 'version' | 'color' | 'emissive' | MaterialMapKey

export interface MaterialPreset {
  key: string
  params: Omit<MaterialParams, PresetOmit>
}

const preset = (
  p: Partial<Omit<MaterialParams, PresetOmit>>,
): MaterialPreset['params'] => ({
  metalness: 0,
  roughness: 0.4,
  transmission: 0,
  opacity: 1,
  clearcoat: 0,
  clearcoatRoughness: 0.1,
  ior: 1.5,
  emissiveIntensity: 0,
  normalScale: 1,
  aoMapIntensity: 1,
  ...p,
})

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { key: 'plasticGlossy',  params: preset({ roughness: 0.15, clearcoat: 0.6 }) },
  { key: 'plasticMatte',   params: preset({ roughness: 0.75 }) },
  { key: 'metalPolished',  params: preset({ metalness: 1, roughness: 0.08 }) },
  { key: 'metalBrushed',   params: preset({ metalness: 1, roughness: 0.45 }) },
  { key: 'glassClear',     params: preset({ roughness: 0.05, transmission: 1 }) },
  { key: 'glassFrosted',   params: preset({ roughness: 0.45, transmission: 1 }) },
  { key: 'rubber',         params: preset({ roughness: 0.95 }) },
  { key: 'ceramic',        params: preset({ roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }) },
]

const clamp01 = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

const clampRange = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const asHex = (v: unknown, fallback: string): string =>
  typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : fallback

const asMapUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

export function normalizeMaterial(raw: unknown): MaterialParams {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_MATERIAL
  const ior = Number(src.ior)
  const maps = Object.fromEntries(
    MATERIAL_MAP_KEYS.map((k) => [k, asMapUrl(src[k])]),
  ) as Record<MaterialMapKey, string | null>
  return {
    version: 1,
    color: asHex(src.color, d.color),
    metalness: clamp01(src.metalness, d.metalness),
    roughness: clamp01(src.roughness, d.roughness),
    transmission: clamp01(src.transmission, d.transmission),
    opacity: clamp01(src.opacity, d.opacity),
    clearcoat: clamp01(src.clearcoat, d.clearcoat),
    clearcoatRoughness: clamp01(src.clearcoatRoughness, d.clearcoatRoughness),
    ior: Number.isFinite(ior) ? Math.min(2.333, Math.max(1, ior)) : d.ior,
    emissive: asHex(src.emissive, d.emissive),
    emissiveIntensity: clamp01(src.emissiveIntensity, d.emissiveIntensity),
    ...maps,
    normalScale: clampRange(src.normalScale, 0, 2, d.normalScale),
    aoMapIntensity: clamp01(src.aoMapIntensity, d.aoMapIntensity),
  }
}

export function parseMaterialState(json: string | null | undefined): MaterialParams {
  if (!json) return { ...DEFAULT_MATERIAL }
  try {
    return normalizeMaterial(JSON.parse(json))
  } catch {
    return { ...DEFAULT_MATERIAL }
  }
}

export function serializeMaterialState(params: MaterialParams): string {
  return JSON.stringify(normalizeMaterial(params))
}

export function materialHasMap(params: MaterialParams, key: MaterialMapKey): boolean {
  return !!params[key]
}
