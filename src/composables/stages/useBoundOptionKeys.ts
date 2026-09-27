import { ref, watch, type Ref } from 'vue'

import { loadWorkflowInfo } from '@/composables/stages/useWorkflowValidator'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import type { LGraphNode } from '@/lib/comfyApp'
import { bindWidgetCallback, getWidget, onNodeConfigure } from '@/utils/widget'

/** Bound `option:<key>` names for the stage's current workflow label. */
export function useBoundOptionKeys(
  getNode: () => LGraphNode | undefined,
  workflowKind: Ref<string | null | undefined> | (() => string | null | undefined),
): {
  keys: Ref<Set<string>>
  isBound: (name: string) => boolean
  refresh: () => Promise<void>
} {
  const keys = ref<Set<string>>(new Set())
  let refreshId = 0
  let activeIdentity = ''

  function kindOf(): string {
    const k = typeof workflowKind === 'function' ? workflowKind() : workflowKind.value
    return k == null ? '' : String(k)
  }

  async function refresh() {
    const currentRefreshId = ++refreshId
    const kind = kindOf()
    const label = String(getWidget(getNode(), 'workflow')?.value ?? '')
    if (!kind || !label) {
      activeIdentity = ''
      keys.value = new Set()
      return
    }
    const identity = `${kind}:${label}`
    if (identity !== activeIdentity) {
      activeIdentity = identity
      keys.value = new Set()
    }
    try {
      const info = await loadWorkflowInfo()
      const opts = (info as any)?.[kind]?.[label]?.uses_options ?? {}
      const currentLabel = String(getWidget(getNode(), 'workflow')?.value ?? '')
      if (currentRefreshId !== refreshId || currentLabel !== label || kind !== kindOf()) return
      keys.value = new Set(
        Object.entries(opts)
          .filter(([, on]) => on)
          .map(([k]) => k),
      )
    } catch {
      if (currentRefreshId === refreshId) keys.value = new Set()
    }
  }

  watch(
    () => [
      kindOf(),
      String(getWidget(getNode(), 'workflow')?.value ?? ''),
      comboOptionsVersion.value,
    ],
    () => { void refresh() },
    { immediate: true },
  )

  bindWidgetCallback(getNode(), 'workflow', () => {
    queueMicrotask(() => { void refresh() })
  })
  onNodeConfigure(getNode(), () => { void refresh() })

  return {
    keys,
    isBound: (name: string) => keys.value.has(name),
    refresh,
  }
}
