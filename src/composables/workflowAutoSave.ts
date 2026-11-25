import { computed, reactive } from 'vue'

import { app } from '@/lib/comfyApp'

export const AUTO_SAVE_FILE = 'comfytv/workflow-autosave.json'
export const AUTO_SAVE_DEFAULTS = { enabled: false, intervalSeconds: 300 }

interface Workflow {
  path: string
  filename?: string
  isTemporary?: boolean
  isLoaded?: boolean
  changeTracker?: { prepareForSave?: () => void } | null
}
export interface WorkflowSaveStore {
  openWorkflows: Workflow[]
  isBusy?: boolean
  saveWorkflow: (workflow: Workflow) => Promise<void>
  renameWorkflow?: (workflow: Workflow, path: string) => Promise<void>
}
export interface SaveAllResult {
  saved: number
  skipped: number
  failures: { path: string; error: string }[]
}

export const workflowAutoSave = reactive({
  enabled: false,
  intervalSeconds: 300,
  loaded: false,
  saving: false,
  configuring: false,
  waiting: false,
  nextSaveAt: null as number | null,
  now: Date.now(),
  lastSavedAt: null as number | null,
  lastSavedCount: 0,
  result: null as SaveAllResult | null,
  error: '',
})
export const autoSaveSecondsLeft = computed(() => workflowAutoSave.nextSaveAt === null
  ? null : Math.max(0, Math.ceil((workflowAutoSave.nextSaveAt - workflowAutoSave.now) / 1000)))

function workflowStore(): WorkflowSaveStore | undefined {
  return (app as any).extensionManager?.workflow
}

function interval(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 10 && number <= 86400
    ? Math.round(number) : AUTO_SAVE_DEFAULTS.intervalSeconds
}

function resetCountdown() {
  workflowAutoSave.now = Date.now()
  workflowAutoSave.nextSaveAt = workflowAutoSave.enabled
    ? workflowAutoSave.now + workflowAutoSave.intervalSeconds * 1000 : null
}

let configurationRevision = 0

export async function loadWorkflowAutoSave(): Promise<void> {
  const revision = configurationRevision
  try {
    const response = await app.api.fetchApi(`/userdata/${encodeURIComponent(AUTO_SAVE_FILE)}`)
    let config = { ...AUTO_SAVE_DEFAULTS }
    if (response.status !== 404) {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data || typeof data !== 'object' || typeof data.enabled !== 'boolean') {
        throw new Error('Invalid auto-save settings')
      }
      config = { enabled: data.enabled, intervalSeconds: interval(data.intervalSeconds) }
    }
    if (revision !== configurationRevision) return
    Object.assign(workflowAutoSave, config)
    workflowAutoSave.error = ''
    workflowAutoSave.loaded = true
    resetCountdown()
  } catch (error) {
    if (revision === configurationRevision) {
      workflowAutoSave.error = String(error instanceof Error ? error.message : error)
    }
  }
}

export async function configureWorkflowAutoSave(enabled: boolean, intervalSeconds: number): Promise<void> {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 86400) {
    throw new Error('Interval must be between 10 and 86400 seconds')
  }
  if (workflowAutoSave.configuring) return
  workflowAutoSave.configuring = true
  try {
    const config = { enabled, intervalSeconds }
    const response = await app.api.fetchApi(`/userdata/${encodeURIComponent(AUTO_SAVE_FILE)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    configurationRevision++
    Object.assign(workflowAutoSave, config, { loaded: true, error: '', waiting: false })
    resetCountdown()
  } finally {
    workflowAutoSave.configuring = false
  }
}

/** Same prepareForSave + store.saveWorkflow sequence used by native Ctrl+S.
 * Background workflows retain their own frozen activeState; never switch tabs
 * or serialize the foreground graph into every workflow.
 */
export async function saveAllOpenWorkflows(
  store: WorkflowSaveStore,
  keepSaving: () => boolean = () => true,
): Promise<SaveAllResult> {
  const result: SaveAllResult = { saved: 0, skipped: 0, failures: [] }
  const workflows = [...new Set(store.openWorkflows)]
  for (const workflow of workflows) {
    if (!keepSaving() || store.isBusy) break
    if (!store.openWorkflows.includes(workflow) || (workflow.isLoaded === false && !workflow.isTemporary)) {
      result.skipped++
      continue
    }
    const previousPath = workflow.path
    try {
      workflow.changeTracker?.prepareForSave?.()
      if (workflow.isTemporary) {
        if (!store.renameWorkflow) throw new Error('Workflow naming is unavailable')
        const stem = (workflow.filename || workflow.path.split('/').pop() || 'Untitled')
          .replace(/(?:\.app)?\.json$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'Untitled'
        // A unique name plus native overwrite=false protects existing files.
        // Once persisted, subsequent saves reuse this path.
        const unique = Array.from(crypto.getRandomValues(new Uint32Array(2)), part => part.toString(16)).join('')
        const extension = /\.app\.json$/i.test(workflow.path) ? '.app.json' : '.json'
        await store.renameWorkflow(workflow, `workflows/自动保存/${stem}-${unique}${extension}`)
        // Capture again after async naming in case edits or a tab switch occurred.
        workflow.changeTracker?.prepareForSave?.()
      }
      await store.saveWorkflow(workflow)
      result.saved++
    } catch (error) {
      result.failures.push({ path: previousPath, error: String(error instanceof Error ? error.message : error) })
    }
  }
  return result
}

export async function saveWorkflowsNow(automatic = false): Promise<void> {
  if (workflowAutoSave.saving) return
  const store = workflowStore()
  if (!store?.saveWorkflow) {
    workflowAutoSave.error = 'Workflow save API is unavailable'
    resetCountdown()
    return
  }
  if (store.isBusy) {
    workflowAutoSave.waiting = workflowAutoSave.enabled
    if (!workflowAutoSave.enabled) workflowAutoSave.error = 'Workflow operation is busy; try saving again'
    workflowAutoSave.nextSaveAt = workflowAutoSave.enabled ? Date.now() + 5000 : null
    return
  }
  workflowAutoSave.saving = true
  workflowAutoSave.waiting = false
  workflowAutoSave.error = ''
  try {
    const result = await saveAllOpenWorkflows(store, () => !automatic || workflowAutoSave.enabled)
    workflowAutoSave.result = result
    if (result.saved) {
      workflowAutoSave.lastSavedAt = Date.now()
      workflowAutoSave.lastSavedCount = result.saved
    }
  } catch (error) {
    workflowAutoSave.error = String(error instanceof Error ? error.message : error)
  } finally {
    workflowAutoSave.saving = false
    resetCountdown()
  }
}

let clock: ReturnType<typeof setInterval> | null = null
export function installWorkflowAutoSave(): void {
  if (clock !== null) return
  void loadWorkflowAutoSave()
  clock = setInterval(() => {
    workflowAutoSave.now = Date.now()
    if (workflowAutoSave.loaded && workflowAutoSave.enabled && !workflowAutoSave.saving
      && workflowAutoSave.nextSaveAt !== null && workflowAutoSave.now >= workflowAutoSave.nextSaveAt) {
      void saveWorkflowsNow(true)
    }
  }, 1000)
}

export function stopWorkflowAutoSave(): void {
  if (clock !== null) clearInterval(clock)
  clock = null
}
