import { ref } from 'vue'

import type { SubscriptionTier } from '@comfyorg/ingest-types'

const tier = ref<SubscriptionTier | null>(null)

export function useBillingContext() {
  return { tier }
}
