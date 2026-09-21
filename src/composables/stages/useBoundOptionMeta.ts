import { ref, watch, type Ref } from 'vue'

import { fetchWorkflowConfig } from '@/api'
import { useBoundOptionKeys } from '@/composables/stages/useBoundOptionKeys'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import type { LGraphNode } from '@/lib/comfyApp'
import { getWidget } from '@/utils/widget'

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
}): BoundOptionMeta {
  const props = w.widget_props ?? {}
  const type = String(w.widget_type ?? '').toUpperCase()
  if (type === 'BOOLEAN') {
    return { key, control: 'toggle', label: key }
  }
  if (type === 'COMBO') {
    return { key, control: 'combo', options: comboValues(props), label: key }
  }
  if (type === 'INT' || type === 'FLOAT') {
    return {
      key,
      control: 'number',
      min: typeof props.min === 'number' ? props.min : undefined,
      max: typeof props.max === 'number' ? props.max : undefined,
      step: typeof props.step === 'number' ? props.step : (type === 'INT' ? 1 : 0.1),
      label: key,
    }
  }
  return { key, control: 'text', label: leafName(String(w.widget_name ?? key)) }
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

  async function refresh() {
    const kind = kindOf()
    const label = String(getWidget(getNode(), 'workflow')?.value ?? '')
    const keys = boundKeys.value
    if (!kind || !label || keys.size === 0) {
      metaByKey.value = new Map()
      return
    }
    try {
      const cfg = await fetchWorkflowConfig(kind, label)
      const next = new Map<string, BoundOptionMeta>()
      for (const w of cfg.exposed_widgets ?? []) {
        const binding = w.stage_binding
        if (typeof binding !== 'string' || !binding.startsWith('option:')) continue
        const key = binding.slice('option:'.length)
        if (!keys.has(key)) continue
        next.set(key, metaFromWidget(key, w))
      }
      metaByKey.value = next
    } catch {
      metaByKey.value = new Map()
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

  return { metaByKey, refresh }
}
