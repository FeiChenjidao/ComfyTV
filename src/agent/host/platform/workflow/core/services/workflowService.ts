import { hostStore } from '../../../../pinia'
import { app } from '../../../../scripts/app'
import type { ComfyWorkflow } from '../../management/stores/comfyWorkflow'

export function useWorkflowService() {
  return {
    async openWorkflow(workflow: ComfyWorkflow): Promise<boolean> {
      const store = hostStore('workflow')
      if (store?.activeWorkflow?.path === workflow.path) return true
      const loaded = typeof workflow.load === 'function' ? await workflow.load() : workflow
      const content = (loaded as any).activeState ?? (loaded as any).originalContent
      if (!content) return false
      await app.loadGraphData(content, true, true, loaded)
      return true
    },
    async saveWorkflowAs(
      workflow: ComfyWorkflow,
      options: { filename?: string; isApp?: boolean } = {},
    ): Promise<boolean> {
      const store = hostStore('workflow')
      if (!store || !options.filename) return false
      const directory =
        typeof workflow.directory === 'string'
          ? workflow.directory
          : workflow.path.split('/').slice(0, -1).join('/')
      const isApp = options.isApp ?? workflow.initialMode === 'app'
      const newPath = `${directory}/${options.filename}${isApp ? '.app' : ''}.json`
      const existing = store.getWorkflowByPath?.(newPath)
      if (existing && !existing.isTemporary) return false
      if (workflow.isTemporary) {
        await store.renameWorkflow(workflow, newPath)
        workflow.changeTracker?.prepareForSave?.()
        await store.saveWorkflow(workflow)
        return true
      }
      if (typeof workflow.saveAs !== 'function') return false
      const target = await workflow.saveAs(newPath)
      return this.openWorkflow(target)
    },
    async closeWorkflow(
      workflow: ComfyWorkflow,
      _options?: { warnIfUnsaved?: boolean },
    ): Promise<void> {
      await hostStore('workflow')?.closeWorkflow?.(workflow)
    },
  }
}
