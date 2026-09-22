import { hostStore, hostVersion } from '../../../../pinia'
import type { NodeLocatorId } from '../../../../types/nodeIdentification'
import type { ComfyWorkflow } from './comfyWorkflow'

export function useWorkflowStore() {
  const version = hostVersion('workflow')
  const host = () => hostStore('workflow')
  return {
    get activeWorkflow(): ComfyWorkflow | null {
      version.value
      return host()?.activeWorkflow ?? null
    },
    get openWorkflows(): ComfyWorkflow[] {
      version.value
      return host()?.openWorkflows ?? []
    },
    get workflows(): ComfyWorkflow[] {
      version.value
      return host()?.workflows ?? []
    },
    nodeToNodeLocatorId(node: any): NodeLocatorId {
      return (host()?.nodeToNodeLocatorId?.(node) ?? String(node?.id ?? '')) as NodeLocatorId
    },
    getWorkflowByPath(path: string): ComfyWorkflow | null {
      version.value
      return host()?.getWorkflowByPath?.(path) ?? null
    },
    createTemporary(name?: string): ComfyWorkflow {
      return host().createTemporary(name)
    },
    createNewTemporary(name?: string, graph?: unknown): ComfyWorkflow {
      const h = host()
      return typeof h.createNewTemporary === 'function'
        ? h.createNewTemporary(name, graph)
        : h.createTemporary(name)
    },
    async syncWorkflows(): Promise<void> {
      await host()?.syncWorkflows?.()
    },
    async closeWorkflow(workflow: ComfyWorkflow): Promise<void> {
      await host()?.closeWorkflow?.(workflow)
    },
  }
}
