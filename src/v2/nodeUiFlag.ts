import { computed, ref, type WritableComputedRef } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'

export function useNodeUiFlag(
  getNode: () => LGraphNode | undefined,
  key: string,
  fallback = false,
): WritableComputedRef<boolean> {
  const tick = ref(0)
  return computed<boolean>({
    get() {
      void tick.value
      const raw = (getNode() as any)?.properties?.[key]
      return typeof raw === 'boolean' ? raw : fallback
    },
    set(value) {
      const node = getNode() as any
      if (!node) return
      ;(node.properties ??= {})[key] = value
      tick.value++
    },
  })
}
