<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@agent/components/ui/button/Button.vue'
import { useAgentTargetNavigation } from '../../../composables/agent/useAgentTargetNavigation'
import { useAgentPanelStore } from '../../../stores/agent/agentPanelStore'
import { useWorkflowService } from '@agent/platform/workflow/core/services/workflowService'
import { useWorkflowStore } from '@agent/platform/workflow/management/stores/workflowStore'
import type { ComfyWorkflowJSON } from '@agent/platform/workflow/validation/schemas/workflowSchema'
import { useToastStore } from '@agent/platform/updates/common/toastStore'
import { api } from '@agent/scripts/api'
import { reportError } from '@agent/platform/telemetry/reportError'
import { useAgentWorkflowTabBindingStore } from '../../../stores/agent/agentWorkflowTabBindingStore'
import { AgentTargetNavigationError } from '../../../services/agent/targetAwareAgentNavigation'

const { workflowId, locatorId, name } = defineProps<{
  workflowId: string
  locatorId?: string
  name?: string
}>()

const { t } = useI18n()
const workflowStore = useWorkflowStore()
const workflowService = useWorkflowService()
const bindingStore = useAgentWorkflowTabBindingStore()
const toast = useToastStore()
const { enabled: agentEnabled } = storeToRefs(useAgentPanelStore())
const targetNavigation = useAgentTargetNavigation()

const tab = computed(() => {
  const path = bindingStore.tabPathFor(workflowId)
  return path === undefined
    ? undefined
    : workflowStore.openWorkflows.find((open) => open.path === path)
})

const label = computed(() => name || tab.value?.filename)

const nodeCountId = useId()
const nodeCount = ref<number>()

watch(
  tab,
  (activeTab) => {
    nodeCount.value = activeTab?.activeState?.nodes?.length
  },
  { immediate: true }
)

useEventListener(
  api,
  'graphChanged',
  (event: CustomEvent<ComfyWorkflowJSON>) => {
    if (tab.value === workflowStore.activeWorkflow) {
      nodeCount.value = event.detail.nodes?.length
    }
  }
)

async function open(): Promise<void> {
  const target = tab.value
  if (!target) return
  if (locatorId === undefined) await workflowService.openWorkflow(target)
  else {
    try {
      await targetNavigation.navigate({ workflowId, locatorId })
    } catch (error) {
      if (!(error instanceof AgentTargetNavigationError))
        reportError(error, { errorType: 'agent_target_navigation_failure' })
      toast.add({
        severity: 'warn',
        detail: t('agent.targetNavigationUnavailable'),
        life: 5000
      })
    }
  }
}
</script>

<template>
  <Button
    v-if="agentEnabled && tab"
    type="button"
    variant="outline"
    size="unset"
    :aria-label="t('agent.openWorkflowTab', { name: label })"
    :aria-describedby="nodeCount === undefined ? undefined : nodeCountId"
    class="ctv:h-[53px] ctv:w-full ctv:justify-start ctv:gap-2.5 ctv:border-component-node-border ctv:px-3 ctv:py-2.5 ctv:text-left ctv:whitespace-normal"
    @click="open"
  >
    <span
      aria-hidden="true"
      data-testid="workflow-link-media"
      class="ctv:flex ctv:size-8 ctv:shrink-0 ctv:items-center ctv:justify-center ctv:rounded-md ctv:border ctv:border-component-node-border ctv:bg-secondary-background ctv:text-muted-foreground"
    >
      <span class="ctv:icon-[comfy--workflow] ctv:size-4" />
    </span>
    <span
      data-testid="workflow-link-content"
      class="ctv:flex ctv:min-w-0 ctv:flex-1 ctv:flex-col ctv:gap-0.5"
    >
      <span class="ctv:truncate ctv:text-sm/4 ctv:font-medium ctv:text-base-foreground">{{
        label
      }}</span>
      <span
        v-if="nodeCount !== undefined"
        :id="nodeCountId"
        class="ctv:text-xs ctv:text-muted-foreground"
      >
        {{ t('g.nodesCount', nodeCount) }}
      </span>
    </span>
    <span
      aria-hidden="true"
      data-testid="workflow-link-navigation"
      class="ctv:icon-[lucide--arrow-right] ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground"
    />
  </Button>
</template>
