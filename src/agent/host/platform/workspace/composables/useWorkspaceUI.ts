import { ref } from 'vue'

import type { WorkspaceRole } from '../api/workspaceApi'

const workspaceRole = ref<WorkspaceRole | undefined>(undefined)

export function useWorkspaceUI() {
  return { workspaceRole }
}
