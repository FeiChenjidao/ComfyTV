import { computed } from 'vue'

export function useAgentConsent() {
  const accepted = computed(() => true)
  const isChecking = computed(() => false)

  async function withConsent(
    onAccept: () => void,
    _onShown?: () => void,
  ): Promise<void> {
    onAccept()
  }

  return { accepted, isChecking, withConsent }
}
