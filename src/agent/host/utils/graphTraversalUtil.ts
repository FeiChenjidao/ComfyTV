import { parseNodeLocatorId } from '../types/nodeIdentification'

function findSubgraphByUuid(graph: any, targetUuid: string): any {
  if (graph && 'subgraphs' in graph && graph.subgraphs instanceof Map) {
    return graph.subgraphs.get(targetUuid) ?? null
  }
  for (const node of graph?.nodes ?? []) {
    if (node.isSubgraphNode?.() && node.subgraph) {
      if (node.subgraph.id === targetUuid) return node.subgraph
      const found = findSubgraphByUuid(node.subgraph, targetUuid)
      if (found) return found
    }
  }
  return null
}

export function getNodeByLocatorId(rootGraph: any, locatorId: string): any {
  if (!rootGraph) return null
  const parsed = parseNodeLocatorId(locatorId)
  if (!parsed) return null
  const { subgraphUuid, localNodeId } = parsed
  if (!subgraphUuid) return rootGraph.getNodeById(localNodeId) || null
  const target = findSubgraphByUuid(rootGraph, subgraphUuid)
  return target ? target.getNodeById(localNodeId) || null : null
}

export function getNodeByExecutionId(rootGraph: any, executionId: string): any {
  if (!rootGraph) return null
  const parts = executionId.split(':')
  let graph = rootGraph
  for (const part of parts.slice(0, -1)) {
    const node = graph.getNodeById(Number(part)) ?? graph.getNodeById(part)
    if (!node?.subgraph) return null
    graph = node.subgraph
  }
  const last = parts[parts.length - 1]
  return graph.getNodeById(Number(last)) ?? graph.getNodeById(last) ?? null
}
