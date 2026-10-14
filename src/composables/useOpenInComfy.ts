import { LINK_TYPE_NATIVE } from '@/api'
import { t } from '@/i18n'
import { app } from '@/lib/comfyApp'

/** Match …/user/<id>/workflows/ so multi-user absolute paths still resolve. */
const NATIVE_ROOT_RE = /\/user\/[^/]+\/workflows\//i
const MANAGED_TAB_PREFIX = 'comfytv/'
const WORKFLOWS_BASE = 'workflows/'

export interface OpenInComfyTarget {
  kind: string
  label: string
  link_type?: number
  file_path?: string
}

interface WorkflowTabHandle {
  load: () => Promise<{ activeState: unknown }>
}

interface WorkflowTabStore {
  getWorkflowByPath?: (path: string) => WorkflowTabHandle | null
  isActive?: (workflow: WorkflowTabHandle) => boolean
}

interface ComfyAppWithTabs {
  loadGraphData: (
    graphData: unknown,
    clean: boolean,
    restoreView: boolean,
    workflow: unknown,
  ) => Promise<void>
  extensionManager?: {
    workflow?: WorkflowTabStore
    toast?: { add?: (message: unknown) => void }
  }
  api: {
    fetchApi: (path: string) => Promise<Response>
    getUserData?: (file: string) => Promise<Response>
  }
}

const comfy = () => app as unknown as ComfyAppWithTabs

export function nativeWorkflowRelPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  const m = NATIVE_ROOT_RE.exec(normalized)
  if (!m || m.index < 0) return null
  return normalized.slice(m.index + m[0].length) || null
}

function stripJsonExt(path: string): string {
  return path.replace(/\.json$/i, '')
}

async function activateExistingTab(fullPath: string): Promise<boolean> {
  const store = comfy().extensionManager?.workflow
  const workflow = store?.getWorkflowByPath?.(fullPath)
  if (!workflow) return false
  if (store?.isActive?.(workflow)) return true
  const loaded = await workflow.load()
  await comfy().loadGraphData(loaded.activeState, true, true, workflow)
  return true
}

async function fetchNativeWorkflowJson(relPath: string): Promise<unknown> {
  const { api } = comfy()
  // Always read via ComfyTV: team library is user/default/workflows, while
  // ComfyUI /userdata is scoped to the logged-in multi-user account.
  const resp = await api.fetchApi(
    `/comfytv/workflows/native/file?path=${encodeURIComponent(relPath)}`,
  )
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`
    try {
      const j = await resp.json()
      if (j?.error) detail += ` — ${j.error}`
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  return resp.json()
}

export async function openNativeWorkflowInComfy(relPath: string): Promise<void> {
  const fullPath = WORKFLOWS_BASE + relPath
  if (await activateExistingTab(fullPath)) return
  const json = await fetchNativeWorkflowJson(relPath)
  await comfy().loadGraphData(json, true, true, stripJsonExt(relPath))
}

export async function openManagedWorkflowInComfy(
  kind: string, label: string,
): Promise<void> {
  const tabPath = `${MANAGED_TAB_PREFIX}${kind}/${label}.json`
  if (await activateExistingTab(WORKFLOWS_BASE + tabPath)) return
  const resp = await comfy().api.fetchApi(
    `/comfytv/workflows/file?kind=${encodeURIComponent(kind)}&label=${encodeURIComponent(label)}`,
  )
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`
    try {
      const j = await resp.json()
      if (j?.error) detail += ` — ${j.error}`
    } catch {}
    throw new Error(detail)
  }
  const json = await resp.json()
  await comfy().loadGraphData(json, true, true, stripJsonExt(tabPath))
}

export async function openWorkflowInComfy(target: OpenInComfyTarget): Promise<void> {
  if (target.link_type === LINK_TYPE_NATIVE && target.file_path) {
    const relPath = nativeWorkflowRelPath(target.file_path)
    if (relPath) {
      await openNativeWorkflowInComfy(relPath)
      return
    }
  }
  await openManagedWorkflowInComfy(target.kind, target.label)
}

function toastOpenFailed(error: unknown): void {
  const detail = String((error as Error)?.message || error || 'open failed')
  comfy().extensionManager?.toast?.add?.({
    severity: 'error',
    summary: t('openInComfy.failed', { detail }),
    life: 5000,
  })
}

export async function tryOpenWorkflowInComfy(target: OpenInComfyTarget): Promise<boolean> {
  try {
    await openWorkflowInComfy(target)
    return true
  } catch (e) {
    toastOpenFailed(e)
    return false
  }
}

export async function tryOpenNativeWorkflowInComfy(relPath: string): Promise<boolean> {
  try {
    await openNativeWorkflowInComfy(relPath)
    return true
  } catch (e) {
    toastOpenFailed(e)
    return false
  }
}
