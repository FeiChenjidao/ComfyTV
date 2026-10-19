import { ref, watch, type Ref } from 'vue'

import { fetchWorkflowConfig } from '@/api'
import { useBoundOptionKeys } from '@/composables/stages/useBoundOptionKeys'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import type { LGraphNode } from '@/lib/comfyApp'
import { bindWidgetCallback, getWidget, onNodeConfigure } from '@/utils/widget'

export type BoundOptionControl =
  | 'toggle'
  | 'number'
  | 'combo'
  | 'text'

export interface BoundOptionMeta {
  key: string
  control: BoundOptionControl
  options?: string[]
  min?: number
  max?: number
  step?: number
  label?: string
  defaultValue?: string
  /** True when the partner-node input is marked advanced=True. */
  advanced?: boolean
  /** Option key of the DynamicCombo parent this child depends on. */
  dynamicParent?: string
  /** Parent combo values for which this child is visible. */
  dynamicWhen?: string[]
  /** parent DynamicCombo: optionKey -> child option keys visible in that branch */
  dynamicBranches?: Record<string, string[]>
}

function leafName(widgetName: string): string {
  const i = widgetName.lastIndexOf('.')
  return i >= 0 ? widgetName.slice(i + 1) : widgetName
}

function comboValues(props: Record<string, unknown> | null | undefined): string[] {
  const raw = props?.values ?? props?.options
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map(String)
}

function metaFromWidget(key: string, w: {
  widget_type?: string
  widget_props?: Record<string, unknown> | null
  widget_name?: string
  override_value?: string | null
}, parentOptionKey?: string | null): BoundOptionMeta {
  const props = w.widget_props ?? {}
  const type = String(w.widget_type ?? '').toUpperCase()
  const defaultValue = w.override_value == null || w.override_value === ''
    ? undefined
    : String(w.override_value)
  const advanced = props.advanced === true
  const whenRaw = props.dynamic_when
  const dynamicWhen = Array.isArray(whenRaw) ? whenRaw.map(String) : undefined
  const dynamicParent = parentOptionKey
    || (typeof props.dynamic_parent === 'string' ? props.dynamic_parent : undefined)
  if (type === 'BOOLEAN') {
    return { key, control: 'toggle', label: key, defaultValue, advanced, dynamicParent, dynamicWhen }
  }
  if (type === 'COMBO') {
      const branchesRaw = props.dynamic_branches
  let dynamicBranches: Record<string, string[]> | undefined
  if (branchesRaw && typeof branchesRaw === 'object' && !Array.isArray(branchesRaw)) {
    dynamicBranches = {}
    for (const [opt, kids] of Object.entries(branchesRaw as Record<string, unknown>)) {
      dynamicBranches[opt] = Array.isArray(kids) ? kids.map(String) : []
    }
  }
  return { key, control: 'combo', options: comboValues(props), label: key, defaultValue, advanced, dynamicParent, dynamicWhen, dynamicBranches }
  }
  if (type === 'INT' || type === 'FLOAT') {
    return {
      key,
      control: 'number',
      min: typeof props.min === 'number' ? props.min : undefined,
      max: typeof props.max === 'number' ? props.max : undefined,
      step: typeof props.step === 'number' ? props.step : (type === 'INT' ? 1 : 0.1),
      label: key,
      defaultValue,
      advanced,
      dynamicParent,
      dynamicWhen,
    }
  }
  return { key, control: 'text', label: leafName(String(w.widget_name ?? key)), defaultValue, advanced, dynamicParent, dynamicWhen }
}

/**
 * For each bound option:* key, expose control metadata from the workflow's
 * exposed widget (used when Stage has no native widget / StageParam def).
 */
export function useBoundOptionMeta(
  getNode: () => LGraphNode | undefined,
  workflowKind: Ref<string | null | undefined> | (() => string | null | undefined),
): {
  metaByKey: Ref<Map<string, BoundOptionMeta>>
  refresh: () => Promise<void>
} {
  const metaByKey = ref(new Map<string, BoundOptionMeta>())
  const { keys: boundKeys } = useBoundOptionKeys(getNode, workflowKind)

  function kindOf(): string {
    const k = typeof workflowKind === 'function' ? workflowKind() : workflowKind.value
    return k == null ? '' : String(k)
  }

  let refreshId = 0
  let activeRequest = ''

  async function refresh() {
    const currentRefreshId = ++refreshId
    const kind = kindOf()
    const label = String(getWidget(getNode(), 'workflow')?.value ?? '')
    const keys = boundKeys.value
    const keySignature = [...keys].sort().join('\0')
    const request = `${kind}:${label}:${keySignature}`
    if (request !== activeRequest) {
      activeRequest = request
      metaByKey.value = new Map()
    }
    if (!kind || !label || keys.size === 0) {
      metaByKey.value = new Map()
      return
    }
    try {
      const cfg = await fetchWorkflowConfig(kind, label)
      const currentLabel = String(getWidget(getNode(), 'workflow')?.value ?? '')
      const currentKeys = [...boundKeys.value].sort().join('\0')
      if (
        currentRefreshId !== refreshId
        || currentLabel !== label
        || kind !== kindOf()
        || currentKeys !== keySignature
      ) return
      const widgetToOption = new Map<string, string>()
      for (const w of cfg.exposed_widgets ?? []) {
        const binding = w.stage_binding
        if (typeof binding !== 'string' || !binding.startsWith('option:')) continue
        const key = binding.slice('option:'.length)
        if (!key || typeof w.widget_name !== 'string') continue
        widgetToOption.set(w.widget_name, key)
      }
      const next = new Map<string, BoundOptionMeta>()
      for (const w of cfg.exposed_widgets ?? []) {
        const binding = w.stage_binding
        if (typeof binding !== 'string' || !binding.startsWith('option:')) continue
        const key = binding.slice('option:'.length)
        if (!keys.has(key)) continue
        const parentWidget = typeof w.widget_props?.dynamic_parent === 'string'
          ? w.widget_props.dynamic_parent
          : null
        const parentOption = parentWidget
          ? (widgetToOption.get(parentWidget) ?? leafName(parentWidget))
          : null
        const meta = metaFromWidget(key, w, parentOption)
        const prev = next.get(key)
        // Prefer a primary (non-advanced) binding when several widgets share a key.
        if (!prev || (prev.advanced && !meta.advanced)) next.set(key, meta)
        else if (prev && meta.dynamicWhen?.length) {
          const mergedWhen = [...new Set([...(prev.dynamicWhen ?? []), ...meta.dynamicWhen])]
          next.set(key, { ...prev, dynamicWhen: mergedWhen, dynamicParent: prev.dynamicParent ?? meta.dynamicParent })
        }
      }
      // Remap parent dynamic_branches child widget names to option:* keys.
      for (const [key, meta] of next) {
        if (!meta.dynamicBranches) continue
        const mapped: Record<string, string[]> = {}
        for (const [opt, kids] of Object.entries(meta.dynamicBranches)) {
          mapped[opt] = kids.map(wn => widgetToOption.get(wn) ?? leafName(wn))
        }
        next.set(key, { ...meta, dynamicBranches: mapped })
      }
      metaByKey.value = next
    } catch {
      if (currentRefreshId === refreshId) metaByKey.value = new Map()
    }
  }

  watch(
    () => [
      kindOf(),
      String(getWidget(getNode(), 'workflow')?.value ?? ''),
      [...boundKeys.value].sort().join('\0'),
      comboOptionsVersion.value,
    ],
    () => { void refresh() },
    { immediate: true },
  )

  bindWidgetCallback(getNode(), 'workflow', () => {
    queueMicrotask(() => { void refresh() })
  })
  onNodeConfigure(getNode(), () => { void refresh() })

  return { metaByKey, refresh }
}
