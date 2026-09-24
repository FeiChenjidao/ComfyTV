import { ref } from 'vue'

const canTopUp = ref(false)
const canSubscribeSelfServe = ref(false)
const hasResolvedCapabilities = ref(true)

export function useBillingCapabilities() {
  return { canTopUp, canSubscribeSelfServe, hasResolvedCapabilities }
}
