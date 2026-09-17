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
}

const cache = new Map<string, Partial<Record<BoundOptionWidget, string[]>>>()

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

export async function loadBoundOptionEnums(
  kind: string,
  label: string,
): Promise<Partial<Record<BoundOptionWidget, string[]>>> {
  const cacheKey = `${kind}::${label}`
  const hit = cache.get(cacheKey)
  if (hit) return hit
  try {
    await prepareWorkflow(kind, label).catch(() => {})
    let cfg = await fetchWorkflowConfig(kind, label)
    if (await ensureOptionBindings(cfg)) {
      cfg = await fetchWorkflowConfig(kind, label)
    }
    const enums = enumsFromExposedWidgets(cfg.exposed_widgets ?? [])
    cache.set(cacheKey, enums)
    return enums
  } catch (e) {
    console.warn('[ComfyTV] loadBoundOptionEnums failed', kind, label, e)
    cache.set(cacheKey, {})
    return {}
  }
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
): Promise<boolean> {
  if (!node?.widgets || !kind) return false
  const enums = label ? await loadBoundOptionEnums(kind, label) : {}
  let changed = false
  for (const name of BOUND_OPTION_WIDGETS) {
    const w = node.widgets.find((x: any) => x?.name === name) as any
    if (!w) continue
    if (!w.options) w.options = {}
    const next = (enums[name]?.length ? enums[name]! : [...STAGE_DEFAULTS[name]]).map(String)
    const prev = Array.isArray(w.options.values) ? w.options.values.map(String) : []
    if (prev.length === next.length && prev.every((v: string, i: number) => v === next[i])) {
      continue
    }
    w.options.values = next
    const picked = pickValue(next, w.value, STAGE_DEFAULTS[name])
    if (String(w.value ?? '') !== picked) {
      w.value = picked
      w.callback?.(picked)
    }
    changed = true
  }
  if (changed) comboOptionsVersion.value++
  return changed
}
