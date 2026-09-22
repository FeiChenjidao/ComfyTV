import { parseNodeId } from './nodeId'
import type { NodeId } from './nodeId'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type NodeLocatorId = string & { readonly __brand: 'NodeLocatorId' }

function requireNodeIdSegment(value: unknown): NodeId | null {
  const nodeId = parseNodeId(value)
  if (!nodeId || String(nodeId).includes(':')) return null
  return nodeId
}

export function parseNodeLocatorId(id: string): { subgraphUuid: string | null; localNodeId: NodeId } | null {
  const parts = id.split(':')
  if (parts.length === 1) {
    const localNodeId = requireNodeIdSegment(id)
    return localNodeId ? { subgraphUuid: null, localNodeId } : null
  }
  if (parts.length !== 2) return null
  const [subgraphUuid, localNodeIdPart] = parts
  if (!UUID_PATTERN.test(subgraphUuid)) return null
  const localNodeId = requireNodeIdSegment(localNodeIdPart)
  return localNodeId ? { subgraphUuid, localNodeId } : null
}

export function isNodeLocatorId(value: unknown): value is NodeLocatorId {
  return typeof value === 'string' && parseNodeLocatorId(value) !== null
}

export function createNodeLocatorId(subgraphUuid: string | null, localNodeId: NodeId): NodeLocatorId {
  const nodeId = requireNodeIdSegment(localNodeId)
  if (!nodeId) return String(localNodeId) as NodeLocatorId
  if (!subgraphUuid || !UUID_PATTERN.test(subgraphUuid)) return String(nodeId) as NodeLocatorId
  return `${subgraphUuid}:${nodeId}` as NodeLocatorId
}
