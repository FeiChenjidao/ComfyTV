import type { Ref } from 'vue'
import { computed } from 'vue'

export function useModalLiftedZIndex(_open: Ref<boolean>) {
  return computed<{ zIndex: number } | undefined>(() => undefined)
}
