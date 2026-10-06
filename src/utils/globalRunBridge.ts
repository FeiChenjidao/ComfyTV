const COMFYTV_PREFIX = 'ComfyTV.'
const OUT_BRIDGE_PREFIX = 'ComfyTV.BridgeFrom'

export function isComfyTVClass(classType: string): boolean {
  return classType.startsWith(COMFYTV_PREFIX)
}

export function isOutBridgeClass(classType: string): boolean {
  return classType.startsWith(OUT_BRIDGE_PREFIX)
}

export interface GlobalRunRewriteDeps {
  getSnapshot: (originId: string, slot: number) => string | null | undefined
}

export interface GlobalRunRewriteResult {
  output: Record<string, any>
  missing: string[]
}

export function rewriteGlobalRunOutput(
  output: Record<string, any>,
  { getSnapshot }: GlobalRunRewriteDeps,
): GlobalRunRewriteResult {
  const missing: string[] = []
  const kept: Record<string, any> = {}

  for (const [id, node] of Object.entries(output)) {
    const ct = String(node?.class_type ?? '')
    if (isComfyTVClass(ct) && !isOutBridgeClass(ct)) continue
    kept[id] = node
  }

  for (const [id, node] of Object.entries(kept)) {
    if (!isOutBridgeClass(String(node?.class_type ?? ''))) continue
    const inputs = node?.inputs
    if (!inputs || typeof inputs !== 'object') continue

    let clonedInputs: Record<string, any> | null = null
    for (const key of Object.keys(inputs)) {
      const val = inputs[key]
      if (!Array.isArray(val) || val.length !== 2) continue
      const originId = String(val[0])
      const originSlot = Number(val[1]) || 0
      const snap = getSnapshot(originId, originSlot)
      if (snap != null) {
        const target = clonedInputs ?? (clonedInputs = { ...inputs })
        target[key] = snap
      } else {
        const label = String(node?._meta?.title || node?.class_type || `#${id}`)
        missing.push(`${label} (#${id})`)
      }
    }
    if (clonedInputs) kept[id] = { ...node, inputs: clonedInputs }
  }

  return { output: kept, missing }
}

interface StageSnapshotSource {
  getStage: (node: any) => { output: string | null; outputs: (string | null)[] } | undefined
}

export interface InstallGlobalRunBridgeDeps {
  resolveStore: () => StageSnapshotSource
  toast: (opts: { severity: string; summary: string; detail: string; life: number }) => void
  t: (key: string, params?: Record<string, unknown>) => string
  attachAuth?: (api: any) => Promise<void>
}

const NON_RUNNABLE_STAGE_SUFFIXES = [
  'ProjectStage', 'ImagePickerStage', 'AudioPickerStage', 'VideoPickerStage',
]

function stageNodesInDependencyOrder(app: any): any[] {
  const nodes = (app?.graph?._nodes ?? []).filter((node: any) => {
    const cls = String(node?.comfyClass ?? node?.type ?? '')
    return isComfyTVClass(cls)
      && !isOutBridgeClass(cls)
      && !NON_RUNNABLE_STAGE_SUFFIXES.some((suffix) => cls.endsWith(suffix))
      && typeof node?.__comfytvStageApi?.onRunRequest === 'function'
      && node?.__comfytvStageApi?.variant !== 'loader'
  })
  const ids = new Set(nodes.map((node: any) => String(node.id)))
  const deps = new Map<any, Set<any>>()
  const dependents = new Map<any, any[]>()
  for (const node of nodes) {
    const set = new Set<any>()
    for (const input of node.inputs ?? []) {
      const link = app.graph?.links?.get?.(input.link) ?? app.graph?.links?.[input.link]
      const origin = link ? app.graph?.getNodeById?.(link.origin_id) : null
      if (origin && ids.has(String(origin.id))) set.add(origin)
    }
    deps.set(node, set)
    for (const origin of set) dependents.set(origin, [...(dependents.get(origin) ?? []), node])
  }
  const ready = nodes.filter((node: any) => !deps.get(node)?.size)
  const ordered: any[] = []
  while (ready.length) {
    const node = ready.shift()
    ordered.push(node)
    for (const child of dependents.get(node) ?? []) {
      deps.get(child)?.delete(node)
      if (!deps.get(child)?.size) ready.push(child)
    }
  }
  return ordered.length === nodes.length
    ? ordered
    : [...ordered, ...nodes.filter((node: any) => !ordered.includes(node))]
}

async function runStageAndWait(node: any): Promise<boolean> {
  const state = node.__comfytvStageApi.state
  state.error = null
  try {
    await node.__comfytvStageApi.onRunRequest()
  } catch {
    return false
  }
  const deadline = Date.now() + 15 * 60 * 1000
  const startDeadline = Date.now() + 30 * 1000
  let started = false
  while (Date.now() < deadline) {
    if (state.error) return false
    if (state.running) started = true
    if (started && !state.running) return true
    if (!started && Date.now() >= startDeadline) return false
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

export async function runComfyTVStagesSequentially(app: any): Promise<boolean> {
  for (const node of stageNodesInDependencyOrder(app)) {
    if (!(await runStageAndWait(node))) return false
  }
  return true
}

export function installGlobalRunBridge(app: any, deps: InstallGlobalRunBridgeDeps): boolean {
  if (app.__comfytvQueuePatched || typeof app.api?.queuePrompt !== 'function') return false
  app.__comfytvQueuePatched = true

  const origQueue = app.api.queuePrompt.bind(app.api)
  const attachAuth = deps.attachAuth
  const withAuth = async (number: number, data: any, options: any) => {
    const api = app.api
    const prevToken = api.authToken
    const prevKey = api.apiKey
    try {
      await attachAuth?.(api)
      return origQueue(number, data, options)
    } finally {
      api.authToken = prevToken
      api.apiKey = prevKey
    }
  }
  app.api.queuePrompt = async (number: number, data: any, options: any = {}) => {
    if (data?.__comfytvOwnRun) {
      if (data && typeof data === 'object') delete data.__comfytvOwnRun
      return withAuth(number, data, options)
    }
    const isGlobalRun = !options?.partialExecutionTargets?.length
    if (isGlobalRun) {
      const hasStages = data?.output
        ? Object.values(data.output).some((node: any) => {
        const cls = String(node?.class_type ?? '')
        return isComfyTVClass(cls) && !isOutBridgeClass(cls)
          })
        : (app.graph?._nodes ?? []).some((node: any) => {
          const cls = String(node?.comfyClass ?? node?.type ?? '')
          return isComfyTVClass(cls) && !isOutBridgeClass(cls)
        })
      if (hasStages && !(await runComfyTVStagesSequentially(app))) {
        deps.toast({
          severity: 'error',
          summary: deps.t('run.stagesRunFailed'),
          detail: deps.t('run.stagesRunFailed'),
          life: 7000,
        })
        return { prompt_id: '', number, node_errors: {} }
      }
      if (!data?.output) return { prompt_id: '', number, node_errors: {} }
      const store = deps.resolveStore()
      const getSnapshot = (originId: string, slot: number) => {
        const gn = app.graph?.getNodeById?.(Number(originId))
                ?? app.graph?.getNodeById?.(String(originId))
        const st = gn ? store.getStage(gn) : undefined
        if (!st) return null
        const slotted = st.outputs?.[slot]
        if (slotted != null) return slotted
        if (slot === 0 && st.output) return st.output
        return null
      }

      const { output: rewritten, missing } = rewriteGlobalRunOutput(data.output, { getSnapshot })

      if (missing.length > 0) {
        deps.toast({
          severity: 'warn',
          summary: deps.t('error.upstreamNotReady'),
          detail: deps.t('error.upstreamNotReadyDetail', { list: [...new Set(missing)].join(', ') }),
          life: 6000,
        })
        return { prompt_id: '', number, node_errors: {} }
      }

      if (Object.keys(rewritten).length === 0) {
        deps.toast({
          severity: 'info',
          summary: 'ComfyTV',
          detail: deps.t('run.stagesRunComplete'),
          life: 4000,
        })
        return { prompt_id: '', number, node_errors: {} }
      }

      data = { ...data, output: rewritten }
    }
    return withAuth(number, data, options)
  }
  return true
}
