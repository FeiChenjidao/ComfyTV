import { useFocusNode } from '@agent/composables/canvas/useFocusNode'
import type { LGraphNode } from '@agent/lib/litegraph/src/litegraph'
import { useWorkflowService } from '@agent/platform/workflow/core/services/workflowService'
import type { ComfyWorkflow } from '@agent/platform/workflow/management/stores/comfyWorkflow'
import { useWorkflowStore } from '@agent/platform/workflow/management/stores/workflowStore'
import { app } from '@agent/scripts/app'
import { getNodeByLocatorId } from '@agent/utils/graphTraversalUtil'

import { useAgentWorkflowTabBindingStore } from '../../stores/agent/agentWorkflowTabBindingStore'
import { createTargetAwareAgentNavigation } from '../../services/agent/targetAwareAgentNavigation'

export function useAgentTargetNavigation() {
  const bindingStore = useAgentWorkflowTabBindingStore()
  const workflowStore = useWorkflowStore()
  const workflowService = useWorkflowService()
  const { focusNodeInstance } = useFocusNode()

  return createTargetAwareAgentNavigation<ComfyWorkflow, LGraphNode>({
    tabForWorkflow: (workflowId) => {
      const path = bindingStore.tabPathFor(workflowId)
      return path === undefined
        ? undefined
        : (workflowStore.getWorkflowByPath(path) ?? undefined)
    },
    isOpen: (tab) => workflowStore.openWorkflows.includes(tab),
    activate: (tab) => workflowService.openWorkflow(tab),
    activeTab: () => workflowStore.activeWorkflow ?? undefined,
    resolveIn: (tab, locatorId) =>
      workflowStore.activeWorkflow === tab
        ? (getNodeByLocatorId(app.rootGraph, locatorId) ?? undefined)
        : undefined,
    focus: focusNodeInstance
  })
}
