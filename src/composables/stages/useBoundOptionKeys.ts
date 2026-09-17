import { ref, watch, type Ref } from 'vue'

import { loadWorkflowInfo } from '@/composables/stages/useWorkflowValidator'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import type { LGraphNode } from '@/lib/comfyApp'
import { getWidget } from '@/utils/widget'

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

  function kindOf(): string {
    const k = typeof workflowKind === 'function' ? workflowKind() : workflowKind.value
    return k == null ? '' : String(k)
  }

  async function refresh() {
    const kind = kindOf()
    const label = String(getWidget(getNode(), 'workflow')?.value ?? '')
    if (!kind || !label) {
      keys.value = new Set()
      return
    }
    try {
      const info = await loadWorkflowInfo()
      const opts = (info as any)?.[kind]?.[label]?.uses_options ?? {}
      keys.value = new Set(
        Object.entries(opts)
          .filter(([, on]) => on)
          .map(([k]) => k),
      )
    } catch {
      keys.value = new Set()
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

  return {
    keys,
    isBound: (name: string) => keys.value.has(name),
    refresh,
  }
}
