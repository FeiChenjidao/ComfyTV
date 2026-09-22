<template>
  <div
    v-if="docked"
    data-testid="docked-agent-panel"
    role="complementary"
    aria-labelledby="agent-panel-title"
    class="docked-agent-panel ctv:pointer-events-auto ctv:relative ctv:h-full ctv:shrink-0 ctv:overflow-hidden [anchor-name:--docked-agent-panel]"
    :style="{ width: `${width}px` }"
  >
    <div
      data-testid="agent-panel-resize-handle"
      class="agent-resize-handle ctv:absolute ctv:top-0 ctv:left-0 ctv:z-10 ctv:h-full ctv:w-[5px] ctv:cursor-col-resize"
      :data-resizing="isResizing"
      @pointerdown="onResizeStart"
      @lostpointercapture="isResizing = false"
    />
    <div
      data-testid="docked-agent-panel-shell"
      :class="
        cn(
          'ctv:size-full ctv:p-2',
          hasOpaqueNeighbor &&
            'ctv:border-l ctv:border-interface-stroke ctv:bg-base-background'
        )
      "
    >
      <div
        class="ctv:size-full ctv:overflow-hidden ctv:rounded-lg ctv:border ctv:border-interface-stroke"
      >
        <AgentPanelRoot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cn } from '@comfyorg/tailwind-utils'
import { useEventListener } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { defineAsyncComponent, defineComponent, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { reportError } from '@agent/platform/telemetry/reportError'
import { useAgentPanelStore } from '../../stores/agent/agentPanelStore'
import { useAgentRunModeStore } from '../../stores/agent/agentRunModeStore'

const AgentPanelLoadError = defineComponent({
  name: 'AgentPanelLoadError',
  setup() {
    const { t } = useI18n()
    return () =>
      h('div', { class: 'ctv:size-full ctv:bg-base-background ctv:p-3' }, [
        h(
          'h2',
          { id: 'agent-panel-title', class: 'ctv:sr-only' },
          t('agent.title')
        ),
        h('p', { class: 'ctv:text-sm ctv:text-base-foreground' }, t('agent.loadFailed'))
      ])
  }
})

// Only a failed chunk load is a load failure; runtime errors inside the
// resolved panel keep their normal propagation.
const AgentPanelRoot = defineAsyncComponent({
  loader: () => import('../../AgentPanelRoot.vue'),
  errorComponent: AgentPanelLoadError,
  onError: (error, _retry, fail) => {
    reportError(error, { errorType: 'agent_panel_load_failure' })
    fail()
  }
})

/** Set by the parent that lays out both this panel and its left neighbour. */
const { hasOpaqueNeighbor = false } = defineProps<{
  hasOpaqueNeighbor?: boolean
}>()

const agentPanelStore = useAgentPanelStore()
const { isVisible: docked, width } = storeToRefs(agentPanelStore)
const agentRunModeStore = useAgentRunModeStore()

void agentRunModeStore.load().catch((error: unknown) => {
  reportError(error, { errorType: 'agent_run_mode_load_failure' })
})

const isResizing = ref(false)
let resizeStartX = 0
let resizeStartWidth = 0

function onResizeStart(e: PointerEvent): void {
  isResizing.value = true
  resizeStartX = e.clientX
  resizeStartWidth = agentPanelStore.width
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}

useEventListener(document, 'pointermove', (e: PointerEvent) => {
  if (!isResizing.value) return
  agentPanelStore.setWidth(resizeStartWidth + (resizeStartX - e.clientX))
})
</script>

<style scoped>
.agent-resize-handle:hover,
.agent-resize-handle[data-resizing='true'] {
  transition: background-color 0.2s ease 300ms;
  background-color: var(--p-primary-color);
}
</style>
