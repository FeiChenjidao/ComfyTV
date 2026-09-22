import { hostStore, hostVersion } from '../pinia'

export function useWorkflowTabActivityStore() {
  const version = hostVersion('workflowTabActivity')
  const host = () => hostStore('workflowTabActivity')
  return {
    get editingTabPath(): string | null {
      version.value
      return host()?.editingTabPath ?? null
    },
    get unseenModifiedPaths(): Set<string> {
      version.value
      const paths = host()?.unseenModifiedPaths
      return paths instanceof Set ? paths : new Set<string>(paths ?? [])
    },
    setEditing(path: string | null): void {
      host()?.setEditing?.(path)
    },
    setCreating(creating: boolean): void {
      host()?.setCreating?.(creating)
    },
    markModified(path: string): void {
      host()?.markModified?.(path)
    },
    markSeen(path: string): void {
      host()?.markSeen?.(path)
    },
    pruneClosed(openPaths: string[]): void {
      host()?.pruneClosed?.(openPaths)
    },
    clearAgentActivity(): void {
      host()?.clearAgentActivity?.()
    },
  }
}
