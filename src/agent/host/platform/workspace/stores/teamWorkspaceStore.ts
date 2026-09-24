import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTeamWorkspaceStore = defineStore('teamWorkspace', () => {
  const activeWorkspaceId = ref<string | null>('local')
  const isSwitching = ref(false)
  const workspaceTransitionGeneration = ref(0)

  async function initialize(): Promise<void> {}

  return {
    activeWorkspaceId,
    isSwitching,
    workspaceTransitionGeneration,
    initialize,
  }
})
