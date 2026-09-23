import { apiSend, fetchWorkflowConfig, OkSchema } from '@/api'
import { prepareWorkflow } from '@/composables/stages/useWorkflowPrep'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import { ASPECT_RATIOS_DEFAULT, RESOLUTIONS } from '@/utils/sizing'
import {
  MODEL3D_GEOMETRY_FORMATS,
  MODEL3D_GEOMETRY_QUALITIES,
  MODEL3D_MATERIALS,
  MODEL3D_MODES,
  MODEL3D_MODEL_VERSIONS,
  MODEL3D_ORIENTATIONS,
  MODEL3D_POLYGON_COUNTS,
  MODEL3D_TEXTURE_ALIGNMENTS,
  MODEL3D_TEXTURE_MODES,
  MODEL3D_TEXTURE_QUALITIES,
} from '@/utils/model3dOptions'
import type { LGraphNode } from '@/lib/comfyApp'

/** Stage widgets whose COMBO list can be replaced by a workflow COMBO. */
export const BOUND_OPTION_WIDGETS = [
  'aspect_ratio',
  'resolution',
  'texture_quality',
  'geometry_quality',
  'model_version',
  'material',
  'mode',
  'polygon_count',
  'geometry_file_format',
  'texture_mode',
  'orientation',
  'texture_alignment',
] as const
export type BoundOptionWidget = (typeof BOUND_OPTION_WIDGETS)[number]

const STAGE_DEFAULTS: Record<BoundOptionWidget, readonly string[]> = {
  aspect_ratio: ASPECT_RATIOS_DEFAULT,
  resolution: RESOLUTIONS,
  texture_quality: MODEL3D_TEXTURE_QUALITIES,
  geometry_quality: MODEL3D_GEOMETRY_QUALITIES,
  model_version: MODEL3D_MODEL_VERSIONS,
  material: MODEL3D_MATERIALS,
  mode: MODEL3D_MODES,
  polygon_count: MODEL3D_POLYGON_COUNTS,
  geometry_file_format: MODEL3D_GEOMETRY_FORMATS,
  texture_mode: MODEL3D_TEXTURE_MODES,
  orientation: MODEL3D_ORIENTATIONS,
  texture_alignment: MODEL3D_TEXTURE_ALIGNMENTS,
}

type ExposedLike = {
  node_id?: string
  widget_name?: string
  stage_binding?: string | null
  widget_type?: string
  widget_props?: Record<string, unknown> | null
  override_value?: string | null
}

<<<<<<< HEAD
const cache = new Map<string, Partial<Record<BoundOptionWidget, string[]>>>()
=======
export type ApplyDefaultsMode = 'all' | 'empty' | false

type BoundPayload = {
  enums: Record<string, string[]>
  defaults: Record<string, string>
}

const cache = new Map<string, BoundPayload>()

/** option:<key> → configured fallback shown on the V2 panel. */
export function defaultsFromExposedWidgets(widgets: ExposedLike[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const w of widgets) {
    const binding = w.stage_binding
    if (typeof binding !== 'string' || !binding.startsWith('option:')) continue
    const key = binding.slice('option:'.length)
    if (!key) continue
    const raw = w.override_value
    if (raw == null || raw === '') continue
    out[key] = String(raw)
  }
  return out
}

function isUnsetValue(value: unknown): boolean {
  return value == null || value === ''
}

function coerceWidgetDefault(w: { type?: unknown }, raw: string): unknown {
  const t = String(w.type ?? '').toLowerCase()
  if (t === 'int' || t === 'number' || t === 'float') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (t === 'boolean' || t === 'toggle') {
    const s = raw.toLowerCase()
    return s === 'true' || s === '1' || s === 'on' || s === 'yes'
  }
  return raw
}

function shouldWriteDefault(mode: ApplyDefaultsMode, current: unknown): boolean {
  if (mode === 'all') return true
  if (mode === 'empty') return isUnsetValue(current)
  return false
}
>>>>>>> b15c43d (Fix ComfyTV workflow nodes and bot integration)

export function clearBoundOptionEnumsCache(kind?: string, label?: string): void {
  if (!kind || !label) {
    cache.clear()
    return
  }
  cache.delete(`${kind}::${label}`)
}

function leafName(widgetName: string): string {
  const i = widgetName.lastIndexOf('.')
  return i >= 0 ? widgetName.slice(i + 1) : widgetName
}

function comboValuesOf(w: ExposedLike): string[] {
  const props = w.widget_props ?? {}
  const raw = props.values ?? props.options
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map(String)
}

/**
 * Prefer widgets bound to option:<name>; otherwise take any COMBO whose leaf
 * name is aspect_ratio / resolution (Nano Banana's model.aspect_ratio, etc.).
 */
export function enumsFromExposedWidgets(
  widgets: ExposedLike[],
): Partial<Record<BoundOptionWidget, string[]>> {
  const out: Partial<Record<BoundOptionWidget, string[]>> = {}
  for (const key of BOUND_OPTION_WIDGETS) {
    const bound = widgets.find(w =>
      w.widget_type === 'COMBO'
      && w.stage_binding === `option:${key}`
      && comboValuesOf(w).length > 0,
    )
    if (bound) {
      out[key] = comboValuesOf(bound)
      continue
    }
    const byName = widgets.find(w =>
      w.widget_type === 'COMBO'
      && typeof w.widget_name === 'string'
      && leafName(w.widget_name) === key
      && comboValuesOf(w).length > 0,
    )
    if (byName) out[key] = comboValuesOf(byName)
  }
  return out
}

/** Wire unbound NanoBanana knobs to Stage options so Run actually uses them. */
export async function ensureOptionBindings(
  cfg: { id?: number; exposed_widgets?: ExposedLike[] } | null | undefined,
): Promise<boolean> {
  if (!cfg?.id || !Array.isArray(cfg.exposed_widgets)) return false
  let wrote = false
  for (const key of BOUND_OPTION_WIDGETS) {
    const already = cfg.exposed_widgets.some(w => w.stage_binding === `option:${key}`)
    if (already) continue
    const candidate = cfg.exposed_widgets.find(w =>
      w.widget_type === 'COMBO'
      && typeof w.widget_name === 'string'
      && leafName(w.widget_name) === key
      && comboValuesOf(w).length > 0
      && w.node_id,
    )
    if (!candidate) continue
    try {
      await apiSend('/comfytv/workflows/config/binding', 'POST', OkSchema, {
        workflow_id: cfg.id,
        node_id: candidate.node_id,
        input_name: candidate.widget_name,
        from: `option:${key}`,
      })
      wrote = true
    } catch (e) {
      console.warn('[ComfyTV] auto-bind option failed', key, e)
    }
  }
  return wrote
}

async function loadBoundOptionPayload(
  kind: string,
  label: string,
<<<<<<< HEAD
): Promise<Partial<Record<BoundOptionWidget, string[]>>> {
  const cacheKey = `${kind}::${label}`
  const hit = cache.get(cacheKey)
  if (hit) return hit
=======
  stageComboNames: readonly string[] = BOUND_OPTION_WIDGETS,
): Promise<BoundPayload> {
  const namesKey = [...stageComboNames].sort().join(',')
  const cacheKey = `${kind}::${label}::${namesKey}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const empty: BoundPayload = { enums: {}, defaults: {} }
>>>>>>> b15c43d (Fix ComfyTV workflow nodes and bot integration)
  try {
    await prepareWorkflow(kind, label).catch(() => {})
    let cfg = await fetchWorkflowConfig(kind, label)
    if (await ensureOptionBindings(cfg)) {
      cfg = await fetchWorkflowConfig(kind, label)
    }
<<<<<<< HEAD
    const enums = enumsFromExposedWidgets(cfg.exposed_widgets ?? [])
    cache.set(cacheKey, enums)
    return enums
=======
    const widgets = cfg.exposed_widgets ?? []
    const payload: BoundPayload = {
      enums: enumsFromExposedWidgets(widgets, stageComboNames),
      defaults: defaultsFromExposedWidgets(widgets),
    }
    cache.set(cacheKey, payload)
    return payload
>>>>>>> b15c43d (Fix ComfyTV workflow nodes and bot integration)
  } catch (e) {
    console.warn('[ComfyTV] loadBoundOptionEnums failed', kind, label, e)
    cache.set(cacheKey, empty)
    return empty
  }
}

export async function loadBoundOptionEnums(
  kind: string,
  label: string,
  stageComboNames: readonly string[] = BOUND_OPTION_WIDGETS,
): Promise<Record<string, string[]>> {
  return (await loadBoundOptionPayload(kind, label, stageComboNames)).enums
}

function applyCustomParamDefaults(
  node: LGraphNode,
  defaults: Record<string, string>,
  nativeNames: Set<string>,
  mode: ApplyDefaultsMode,
): boolean {
  if (!mode) return false
  const w = (node.widgets ?? []).find((x: any) => x?.name === 'custom_params') as any
  if (!w) return false
  let items: Array<{ key: string; value: unknown }>
  try {
    const parsed = JSON.parse(String(w.value ?? ''))
    items = Array.isArray(parsed?.items) ? parsed.items.filter((x: any) => x && typeof x.key === 'string') : []
  } catch {
    items = []
  }
  const byKey = new Map(items.map(it => [it.key, it]))
  let changed = false
  for (const [key, raw] of Object.entries(defaults)) {
    if (nativeNames.has(key)) continue
    const prev = byKey.get(key)
    if (prev) {
      if (!shouldWriteDefault(mode, prev.value)) continue
      if (prev.value === raw) continue
      prev.value = raw
      changed = true
      continue
    }
    items.push({ key, value: raw })
    byKey.set(key, items[items.length - 1]!)
    changed = true
  }
  if (!changed) return false
  w.value = JSON.stringify({ items })
  w.callback?.(w.value)
  return true
}

/** Copy workflow binding fallbacks onto Stage widgets / custom_params for the V2 panel. */
export function applyBoundOptionDefaults(
  node: LGraphNode | undefined | null,
  defaults: Record<string, string>,
  mode: ApplyDefaultsMode,
): boolean {
  if (!node?.widgets || !mode) return false
  const keys = Object.keys(defaults)
  if (!keys.length) return false
  let changed = false
  const nativeNames = new Set<string>()
  for (const w of node.widgets as any[]) {
    const name = String(w?.name ?? '')
    if (!name) continue
    nativeNames.add(name)
    const raw = defaults[name]
    if (raw == null) continue
    if (isComboWidget(w)) {
      const values = Array.isArray(w.options?.values) ? w.options.values.map(String) : []
      if (values.length && !values.includes(raw)) continue
      if (!shouldWriteDefault(mode, w.value)) continue
      if (String(w.value ?? '') === raw) continue
      w.value = raw
      w.callback?.(raw)
      changed = true
      continue
    }
    if (!shouldWriteDefault(mode, w.value)) continue
    const next = coerceWidgetDefault(w, raw)
    if (w.value === next) continue
    w.value = next
    w.callback?.(next)
    changed = true
  }
  if (applyCustomParamDefaults(node, defaults, nativeNames, mode)) changed = true
  return changed
}

function pickValue(next: string[], current: unknown, fallback: readonly string[]): string {
  const cur = current == null ? '' : String(current)
  if (cur && next.includes(cur)) return cur
  for (const cand of ['auto', ...fallback, ...next]) {
    if (next.includes(cand)) return cand
  }
  return next[0] ?? cur
}

/**
 * Replace Stage aspect_ratio / resolution combo lists with the workflow's
 * COMBO enums (bound option:* or matching leaf name like model.aspect_ratio).
 */
export async function syncBoundOptionEnums(
  node: LGraphNode | undefined | null,
  kind: string | null | undefined,
  label: string | null | undefined,
  opts?: { applyDefaults?: ApplyDefaultsMode },
): Promise<boolean> {
  if (!node?.widgets || !kind) return false
<<<<<<< HEAD
  const enums = label ? await loadBoundOptionEnums(kind, label) : {}
  let changed = false
  for (const name of BOUND_OPTION_WIDGETS) {
=======
  const stageCombos = stageComboWidgetNames(node)
  const applyDefaults = opts?.applyDefaults ?? false
  const needsEnums = stageCombos.length > 0
  const needsDefaults = !!applyDefaults
  if (!needsEnums && !needsDefaults) return false
  const payload = label
    ? await loadBoundOptionPayload(kind, label, stageCombos.length ? stageCombos : BOUND_OPTION_WIDGETS)
    : { enums: {}, defaults: {} }
  let changed = false
  for (const name of stageCombos) {
    const fromEnum = payload.enums[name]
    if (!fromEnum?.length) continue
>>>>>>> b15c43d (Fix ComfyTV workflow nodes and bot integration)
    const w = node.widgets.find((x: any) => x?.name === name) as any
    if (!w) continue
    if (!w.options) w.options = {}
    const next = (enums[name]?.length ? enums[name]! : [...STAGE_DEFAULTS[name]]).map(String)
    const prev = Array.isArray(w.options.values) ? w.options.values.map(String) : []
    const listSame = prev.length === next.length && prev.every((v: string, i: number) => v === next[i])
    if (listSame) continue
    w.options.values = next
<<<<<<< HEAD
    const picked = pickValue(next, w.value, STAGE_DEFAULTS[name])
=======
    changed = true
    const fallback = STAGE_DEFAULTS[name] ?? next
    const picked = pickValue(next, w.value, fallback)
>>>>>>> b15c43d (Fix ComfyTV workflow nodes and bot integration)
    if (String(w.value ?? '') !== picked) {
      w.value = picked
      w.callback?.(picked)
    }
  }
  if (applyBoundOptionDefaults(node, payload.defaults, applyDefaults)) changed = true
  if (changed) comboOptionsVersion.value++
  return changed
}
