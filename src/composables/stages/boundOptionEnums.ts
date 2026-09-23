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

/**
 * Known Stage COMBO defaults — used only as pickValue fallbacks when a
 * workflow replaces the list and the current value is no longer valid.
 * Discovery of which knobs to sync is driven by the Stage node itself.
 */
export const BOUND_OPTION_WIDGETS = [
  'aspect_ratio',
  'resolution',
  'scale',
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

const STAGE_DEFAULTS: Record<string, readonly string[]> = {
  aspect_ratio: ASPECT_RATIOS_DEFAULT,
  resolution: RESOLUTIONS,
  scale: ['2x', '4x'],
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

/**
 * Workflow leaf widget names that should feed a Stage option:<key> even when
 * the leaf is not literally named like the Stage widget (WaveSpeed
 * target_resolution → scale, Magnific scale_factor → scale, …).
 */
export const LEAF_TO_OPTION_KEY: Record<string, string> = {
  aspect_ratio: 'aspect_ratio',
  resolution: 'resolution',
  scale: 'scale',
  scale_factor: 'scale',
  Scale: 'scale',
  target_resolution: 'scale',
  Target_Resolution: 'scale',
  texture_quality: 'texture_quality',
  geometry_quality: 'geometry_quality',
  model_version: 'model_version',
  material: 'material',
  Material_Type: 'material',
  mode: 'mode',
  polygon_count: 'polygon_count',
  Polygon_count: 'polygon_count',
  geometry_file_format: 'geometry_file_format',
  texture_mode: 'texture_mode',
  orientation: 'orientation',
  texture_alignment: 'texture_alignment',
}

type ExposedLike = {
  node_id?: string
  widget_name?: string
  stage_binding?: string | null
  widget_type?: string
  widget_props?: Record<string, unknown> | null
  override_value?: string | null
}

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

export function clearBoundOptionEnumsCache(kind?: string, label?: string): void {
  if (!kind || !label) {
    cache.clear()
    return
  }
  const prefix = `${kind}::${label}`
  for (const key of [...cache.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}::`)) cache.delete(key)
  }
}

export function leafName(widgetName: string): string {
  const i = widgetName.lastIndexOf('.')
  return i >= 0 ? widgetName.slice(i + 1) : widgetName
}

/** Map a workflow widget leaf to the Stage option key it should fill. */
export function optionKeyForLeaf(widgetName: string | null | undefined): string | null {
  if (!widgetName) return null
  const leaf = leafName(widgetName)
  if (!leaf) return null
  return LEAF_TO_OPTION_KEY[leaf] ?? leaf
}

function comboValuesOf(w: ExposedLike): string[] {
  const props = w.widget_props ?? {}
  const raw = props.values ?? props.options
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map(String)
}

function isComboWidget(w: { type?: unknown; options?: { values?: unknown } } | null | undefined): boolean {
  if (!w) return false
  const t = String(w.type ?? '')
  if (t === 'combo' || t === 'COMBO') return true
  return Array.isArray(w.options?.values)
}

/** COMBO widgets on this Stage node that can receive workflow enums. */
export function stageComboWidgetNames(node: LGraphNode | undefined | null): string[] {
  const out: string[] = []
  for (const w of (node?.widgets ?? []) as any[]) {
    const name = String(w?.name ?? '')
    if (!name || name === 'workflow' || name.startsWith('$$')) continue
    if (!isComboWidget(w)) continue
    out.push(name)
  }
  return out
}

/**
 * Enums for every bound option:* COMBO, plus leaf-name fallbacks for the
 * Stage knobs we care about (passed in, or the known default set).
 */
export function enumsFromExposedWidgets(
  widgets: ExposedLike[],
  stageComboNames: readonly string[] = BOUND_OPTION_WIDGETS,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const w of widgets) {
    const binding = w.stage_binding
    if (w.widget_type !== 'COMBO' || typeof binding !== 'string' || !binding.startsWith('option:')) {
      continue
    }
    const key = binding.slice('option:'.length)
    const vals = comboValuesOf(w)
    if (vals.length > 0) out[key] = vals
  }
  const wanted = new Set(stageComboNames)
  for (const key of wanted) {
    if (out[key]) continue
    const byName = widgets.find(w =>
      w.widget_type === 'COMBO'
      && typeof w.widget_name === 'string'
      && optionKeyForLeaf(w.widget_name) === key
      && comboValuesOf(w).length > 0,
    )
    if (byName) out[key] = comboValuesOf(byName)
  }
  return out
}

/** Auto-bind unbound workflow COMBOs whose leaf maps onto a Stage option key. */
export async function ensureOptionBindings(
  cfg: { id?: number; exposed_widgets?: ExposedLike[] } | null | undefined,
  stageComboNames: readonly string[] = BOUND_OPTION_WIDGETS,
): Promise<boolean> {
  if (!cfg?.id || !Array.isArray(cfg.exposed_widgets)) return false
  let wrote = false
  for (const key of stageComboNames) {
    const already = cfg.exposed_widgets.some(w => w.stage_binding === `option:${key}`)
    if (already) continue
    const candidate = cfg.exposed_widgets.find(w =>
      w.widget_type === 'COMBO'
      && typeof w.widget_name === 'string'
      && optionKeyForLeaf(w.widget_name) === key
      && comboValuesOf(w).length > 0
      && w.node_id
      && !w.stage_binding,
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
  stageComboNames: readonly string[] = BOUND_OPTION_WIDGETS,
): Promise<BoundPayload> {
  const namesKey = [...stageComboNames].sort().join(',')
  const cacheKey = `${kind}::${label}::${namesKey}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const empty: BoundPayload = { enums: {}, defaults: {} }
  try {
    await prepareWorkflow(kind, label).catch(() => {})
    let cfg = await fetchWorkflowConfig(kind, label)
    if (await ensureOptionBindings(cfg, stageComboNames)) {
      cfg = await fetchWorkflowConfig(kind, label)
    }
    const widgets = cfg.exposed_widgets ?? []
    const payload: BoundPayload = {
      enums: enumsFromExposedWidgets(widgets, stageComboNames),
      defaults: defaultsFromExposedWidgets(widgets),
    }
    cache.set(cacheKey, payload)
    return payload
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
 * Replace every Stage COMBO whose workflow provides option:<name> (or a
 * matching leaf) with that COMBO's values. No whitelist gate — any Stage
 * combo widget is eligible.
 */
export async function syncBoundOptionEnums(
  node: LGraphNode | undefined | null,
  kind: string | null | undefined,
  label: string | null | undefined,
  opts?: { applyDefaults?: ApplyDefaultsMode },
): Promise<boolean> {
  if (!node?.widgets || !kind) return false
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
    const w = node.widgets.find((x: any) => x?.name === name) as any
    if (!w) continue
    if (!w.options) w.options = {}
    const next = fromEnum.map(String)
    const prev = Array.isArray(w.options.values) ? w.options.values.map(String) : []
    const listSame = prev.length === next.length && prev.every((v: string, i: number) => v === next[i])
    if (listSame) continue
    w.options.values = next
    changed = true
    const fallback = STAGE_DEFAULTS[name] ?? next
    const picked = pickValue(next, w.value, fallback)
    if (String(w.value ?? '') !== picked) {
      w.value = picked
      w.callback?.(picked)
    }
  }
  if (applyBoundOptionDefaults(node, payload.defaults, applyDefaults)) changed = true
  if (changed) comboOptionsVersion.value++
  return changed
}
