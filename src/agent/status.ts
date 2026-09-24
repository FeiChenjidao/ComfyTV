import { ref } from 'vue'

import { apiFetch } from '@/api'
import { type BotProviderStatus, BotStatusSchema } from '@/api/schemas/bot'

import { setAgentPanelEnabled } from './mount'

export const agentProviders = ref<BotProviderStatus[]>([])
export const agentEnabled = ref(false)

export async function refreshAgentStatus(): Promise<boolean> {
  try {
    const data = await apiFetch('/comfytv/bot/status', BotStatusSchema)
    agentProviders.value = data.providers
    agentEnabled.value = data.enabled !== false
  } catch (e) {
    console.warn('[ComfyTV/agent] status failed', e)
    agentProviders.value = []
    agentEnabled.value = false
  }
  setAgentPanelEnabled(agentEnabled.value)
  return agentEnabled.value
}
