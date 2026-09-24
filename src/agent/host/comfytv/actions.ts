import { ref } from 'vue'

export const newChatRequests = ref(0)
export const agentBusy = ref(false)

export function requestNewChat(): void {
  newChatRequests.value += 1
}
