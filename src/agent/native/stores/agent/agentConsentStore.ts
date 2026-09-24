import { defineStore } from 'pinia'
import { computed } from 'vue'

export const useAgentConsentStore = defineStore('agentConsent', () => {
  const identity = computed<string | null>(() => 'local')
  const accepted = computed(() => true)
  const isChecking = computed(() => false)

  async function ensureScope(): Promise<string | null> {
    return 'local'
  }
  async function load(): Promise<boolean> {
    return true
  }
  async function accept(_expectedIdentity?: string): Promise<boolean> {
    return true
  }

  return { accepted, identity, isChecking, ensureScope, load, accept }
})
