import { hostStore, hostVersion } from '../pinia'

export function useAgentNodeSelectionStore() {
  const version = hostVersion('agentNodeSelection')
  const host = () => hostStore('agentNodeSelection')
  return {
    get isActive(): boolean {
      version.value
      return host()?.isActive === true
    },
    get isLoadingWorkflow(): boolean {
      version.value
      return host()?.isLoadingWorkflow === true
    },
    get restoredNodeIds(): string[] | null {
      version.value
      return host()?.restoredNodeIds ?? null
    },
    enter(): void {
      host()?.enter?.()
    },
    exit(): void {
      host()?.exit?.()
    },
    finishWorkflowLoad(): void {
      host()?.finishWorkflowLoad?.()
    },
    nodeIds(path: string | undefined): string[] {
      return host()?.nodeIds?.(path) ?? []
    },
    saveNodeIds(path: string | undefined, ids: string[]): void {
      host()?.saveNodeIds?.(path, ids)
    },
  }
}
