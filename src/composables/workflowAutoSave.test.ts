import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '@/lib/comfyApp'
import {
  AUTO_SAVE_FILE, configureWorkflowAutoSave, installWorkflowAutoSave, loadWorkflowAutoSave,
  saveAllOpenWorkflows, saveWorkflowsNow, stopWorkflowAutoSave, workflowAutoSave as state,
  type WorkflowSaveStore,
} from './workflowAutoSave'

const fetchApi = vi.mocked(app.api.fetchApi)
function makeWorkflow(path: string, temporary = false) {
  return { path, isTemporary: temporary, isLoaded: true, changeTracker: { prepareForSave: vi.fn() } }
}
function storeFor(...workflows: ReturnType<typeof makeWorkflow>[]): WorkflowSaveStore {
  return {
    openWorkflows: workflows, isBusy: false,
    saveWorkflow: vi.fn(async workflow => { workflow.isTemporary = false }),
    renameWorkflow: vi.fn(async (workflow, path) => { workflow.path = path }),
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z'))
  fetchApi.mockReset()
  fetchApi.mockResolvedValue(new Response('', { status: 404 }))
  Object.assign(state, { enabled: false, intervalSeconds: 300, loaded: false, saving: false,
    configuring: false, waiting: false, nextSaveAt: null, now: Date.now(), lastSavedAt: null, result: null, error: '' })
  ;(app as any).extensionManager = { workflow: storeFor() }
})
afterEach(() => { stopWorkflowAutoSave(); vi.useRealTimers() })

describe('saving all open local workflows', () => {
  it('flushes each workflow and uses native saving without switching tabs or mixing graphs', async () => {
    const a = makeWorkflow('workflows/a.json')
    const b = makeWorkflow('workflows/b.json')
    const store = storeFor(a, b)
    const result = await saveAllOpenWorkflows(store)
    expect(result).toEqual({ saved: 2, skipped: 0, failures: [] })
    expect(a.changeTracker.prepareForSave).toHaveBeenCalledOnce()
    expect(b.changeTracker.prepareForSave).toHaveBeenCalledOnce()
    expect(vi.mocked(store.saveWorkflow).mock.calls.map(([workflow]) => workflow.path))
      .toEqual(['workflows/a.json', 'workflows/b.json'])
    expect(store.renameWorkflow).not.toHaveBeenCalled()
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it('names untitled workflows once and reuses their saved file in subsequent cycles', async () => {
    const untitled = makeWorkflow('workflows/Untitled.json', true)
    const store = storeFor(untitled)
    await saveAllOpenWorkflows(store)
    const path = untitled.path
    expect(path).toMatch(/^workflows\/自动保存\/Untitled-[a-f0-9]+\.json$/)
    await saveAllOpenWorkflows(store)
    expect(untitled.path).toBe(path)
    expect(store.renameWorkflow).toHaveBeenCalledOnce()
    expect(store.saveWorkflow).toHaveBeenCalledTimes(2)
  })

  it('continues saving the other workflows when one save fails', async () => {
    const store = storeFor(makeWorkflow('workflows/a.json'), makeWorkflow('workflows/b.json'))
    vi.mocked(store.saveWorkflow).mockRejectedValueOnce(new Error('Disk full'))
    const result = await saveAllOpenWorkflows(store)
    expect(result.saved).toBe(1)
    expect(result.failures).toEqual([{ path: 'workflows/a.json', error: 'Disk full' }])
  })

  it('does not overwrite unloaded or closed tabs and snapshots the open list before saving', async () => {
    const a = makeWorkflow('workflows/a.json')
    const b = makeWorkflow('workflows/b.json')
    const unloaded = { ...makeWorkflow('workflows/unloaded.json'), isLoaded: false }
    const store = storeFor(a, b, unloaded)
    vi.mocked(store.saveWorkflow).mockImplementation(async () => { store.openWorkflows = [a, unloaded] })
    const result = await saveAllOpenWorkflows(store)
    expect(result).toEqual({ saved: 1, skipped: 2, failures: [] })
  })
})

describe('local auto-save countdown', () => {
  it('is off by default and does not start saving just because settings were opened', async () => {
    installWorkflowAutoSave()
    await vi.advanceTimersByTimeAsync(600000)
    expect(state.enabled).toBe(false)
    expect((app as any).extensionManager.workflow.saveWorkflow).not.toHaveBeenCalled()
    expect(fetchApi).toHaveBeenCalledWith(`/userdata/${encodeURIComponent(AUTO_SAVE_FILE)}`)
  })

  it('saves all open workflows at the configured deadline, resets, and stops when disabled', async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ enabled: true, intervalSeconds: 20 }))
    const store = storeFor(makeWorkflow('workflows/a.json'), makeWorkflow('workflows/b.json'))
    ;(app as any).extensionManager.workflow = store
    installWorkflowAutoSave()
    await vi.advanceTimersByTimeAsync(19000)
    expect(store.saveWorkflow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.saveWorkflow).toHaveBeenCalledTimes(2)
    expect(state.nextSaveAt).toBe(Date.now() + 20000)
    fetchApi.mockResolvedValueOnce(Response.json('saved'))
    await configureWorkflowAutoSave(false, 20)
    await vi.advanceTimersByTimeAsync(40000)
    expect(store.saveWorkflow).toHaveBeenCalledTimes(2)
    expect(state.nextSaveAt).toBeNull()
  })

  it('waits for native workflow operations and prevents overlapping save cycles', async () => {
    const store = storeFor(makeWorkflow('workflows/a.json'))
    ;(app as any).extensionManager.workflow = store
    store.isBusy = true
    fetchApi.mockResolvedValueOnce(Response.json({ enabled: true, intervalSeconds: 10 }))
    installWorkflowAutoSave()
    await vi.advanceTimersByTimeAsync(10000)
    expect(state.waiting).toBe(true)
    expect(store.saveWorkflow).not.toHaveBeenCalled()
    store.isBusy = false
    const saving = deferred<void>()
    vi.mocked(store.saveWorkflow).mockReturnValue(saving.promise)
    await vi.advanceTimersByTimeAsync(5000)
    expect(state.saving).toBe(true)
    await saveWorkflowsNow()
    await vi.advanceTimersByTimeAsync(30000)
    expect(store.saveWorkflow).toHaveBeenCalledOnce()
    saving.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.saving).toBe(false)
  })

  it('persists account settings and leaves the old schedule intact when saving settings fails', async () => {
    fetchApi.mockResolvedValueOnce(Response.json('saved'))
    await configureWorkflowAutoSave(true, 60)
    expect(JSON.parse(String(fetchApi.mock.calls[0][1]?.body))).toEqual({ enabled: true, intervalSeconds: 60 })
    fetchApi.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(configureWorkflowAutoSave(false, 120)).rejects.toThrow('HTTP 500')
    expect(state.enabled).toBe(true)
    expect(state.intervalSeconds).toBe(60)
    await expect(configureWorkflowAutoSave(true, 0)).rejects.toThrow('Interval')
  })

  it('does not let a late settings read overwrite a newer choice', async () => {
    const pending = deferred<Response>()
    fetchApi.mockReturnValueOnce(pending.promise)
    const loading = loadWorkflowAutoSave()
    fetchApi.mockResolvedValueOnce(Response.json('saved'))
    await configureWorkflowAutoSave(true, 45)
    pending.resolve(Response.json({ enabled: false, intervalSeconds: 300 }))
    await loading
    expect(state.enabled).toBe(true)
    expect(state.intervalSeconds).toBe(45)
  })
})
