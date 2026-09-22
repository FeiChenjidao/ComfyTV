import { nextTick } from 'vue'

import { useCanvasStore } from '../../renderer/core/canvas/canvasStore'
import { app } from '../../scripts/app'
import { getNodeByExecutionId } from '../../utils/graphTraversalUtil'

async function navigateToGraph(targetGraph: any) {
  const canvas = useCanvasStore().canvas
  if (!canvas) return
  if (canvas.graph !== targetGraph) {
    canvas.subgraph = targetGraph.isRootGraph ? undefined : targetGraph
    canvas.setGraph(targetGraph)
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }
}

function visibleViewport(canvas: any): [number, number, number, number] {
  const dock = document.getElementById('local-agent-dock')
  const width = canvas.canvas.width / window.devicePixelRatio
  const height = canvas.canvas.height / window.devicePixelRatio
  const covered = dock ? dock.getBoundingClientRect().width : 0
  return [0, 0, Math.max(width - covered, 0), height]
}

export function useFocusNode() {
  const canvasStore = useCanvasStore()

  async function focusNodeInstance(node: any) {
    if (!canvasStore.canvas || !node.graph) return
    await navigateToGraph(node.graph)
    const canvas = canvasStore.canvas
    if (!canvas || canvas.graph !== node.graph) return
    canvas.animateToBounds(node.boundingRect, { viewport: visibleViewport(canvas) })
  }

  async function focusNode(nodeId: string, executionIdMap?: Map<string, any>) {
    if (!canvasStore.canvas) return
    const graphNode = executionIdMap ? executionIdMap.get(nodeId) : getNodeByExecutionId(app.rootGraph, nodeId)
    if (!graphNode?.graph) return
    await focusNodeInstance(graphNode)
  }

  return { focusNode, focusNodeInstance }
}
