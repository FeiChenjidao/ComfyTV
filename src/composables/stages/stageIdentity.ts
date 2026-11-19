import { app } from '@/lib/comfyApp'

const PROP = 'comfytv_stage_uid'
const PROP_AT = 'comfytv_stage_uid_at'
const WORKFLOW_KEY = '__comfytvWorkflowKey'

const graphKeys = new WeakMap<object, string>()
let nextGraphKey = 1

function activeWorkflowKey(): string {
  const workflow = (app as any)?.extensionManager?.workflow?.activeWorkflow
  const identity = workflow?.path ?? workflow?.legacyId ?? workflow?.id ?? workflow?.activeState?.id
  return identity != null && String(identity) ? `workflow:${String(identity)}` : ''
}

export function workflowKeyForNode(node: any): string {
  if (!node) return 'workflow:unknown'
  const existing = node[WORKFLOW_KEY]
  if (typeof existing === 'string' && existing) return existing
  let key = activeWorkflowKey()
  if (!key && node.graph && typeof node.graph === 'object') {
    key = graphKeys.get(node.graph) ?? ''
    if (!key) {
      key = `graph:${nextGraphKey++}`
      graphKeys.set(node.graph, key)
    }
  }
  if (!key) key = 'workflow:default'
  node[WORKFLOW_KEY] = key
  return key
}

export function stageInstanceKey(node: any): string {
  return `${workflowKeyForNode(node)}::${ensureStageUid(node)}`
}

function genUid(): string {
  const c: any = (globalThis as any).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return (
    'uid-' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

export function ensureStageUid(node: any): string {
  if (!node) return ''
  if (!node.properties || typeof node.properties !== 'object') node.properties = {}
  let uid = node.properties[PROP]
  if (typeof uid !== 'string' || uid.length === 0) {
    uid = genUid()
    node.properties[PROP] = uid
    node.properties[PROP_AT] = new Date().toISOString()
  }
  return uid
}

export function getStageUidClaimedAt(node: any): string | null {
  const at = node?.properties?.[PROP_AT]
  return typeof at === 'string' && at ? at : null
}

export function ensureStageUidClaimedAt(node: any): string {
  const at = getStageUidClaimedAt(node)
  if (at) return at
  if (!node.properties || typeof node.properties !== 'object') node.properties = {}
  const now = new Date().toISOString()
  node.properties[PROP_AT] = now
  return now
}

export function getStageUid(node: any): string {
  const uid = node?.properties?.[PROP]
  return typeof uid === 'string' ? uid : ''
}

const liveUids = new Map<string, any>()

export function claimStageUid(node: any): string {
  if (!node) return ''
  const prev = typeof node.__comfytvClaimedStageKey === 'string' ? node.__comfytvClaimedStageKey : ''
  let uid = ensureStageUid(node)
  let key = `${workflowKeyForNode(node)}::${uid}`
  if (prev && prev !== key && liveUids.get(prev) === node) liveUids.delete(prev)
  const owner = liveUids.get(key)
  if (owner && owner !== node) {
    if (String(owner.id) === String(node.id)) {
      liveUids.delete(key)
    } else {
      uid = genUid()
      node.properties[PROP] = uid
      node.properties[PROP_AT] = new Date().toISOString()
      key = `${workflowKeyForNode(node)}::${uid}`
      console.warn(
        `[ComfyTV/stage] node #${node.id}: stage uid already claimed by node #${owner.id} in this workflow — regenerated`,
      )
    }
  }
  liveUids.set(key, node)
  node.__comfytvClaimedUid = uid
  node.__comfytvClaimedStageKey = key
  return uid
}

export function releaseStageUid(node: any): void {
  if (!node) return
  const key = typeof node.__comfytvClaimedStageKey === 'string'
    ? node.__comfytvClaimedStageKey
    : stageInstanceKey(node)
  if (key && liveUids.get(key) === node) liveUids.delete(key)
  delete node.__comfytvClaimedUid
  delete node.__comfytvClaimedStageKey
}

export function stageClassName(node: any): string {
  const cc = String(node?.comfyClass ?? node?.type ?? '')
  const dot = cc.lastIndexOf('.')
  return dot >= 0 ? cc.slice(dot + 1) : cc
}
