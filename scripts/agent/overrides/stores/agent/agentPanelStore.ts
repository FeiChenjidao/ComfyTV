import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import type { AgentPanelCloseSource } from '@agent/platform/telemetry/types'
import type { ComfyWorkflow } from '@agent/platform/workflow/management/stores/comfyWorkflow'
import { useWorkflowStore } from '@agent/platform/workflow/management/stores/workflowStore'

const PANEL_MIN_WIDTH = 420
const PANEL_MAX_WIDTH = 960
const OPEN_STORAGE_KEY = 'ComfyTV.AgentPanel.open'
const WIDTH_STORAGE_KEY = 'ComfyTV.AgentPanel.width'
const DISCOVERED_STORAGE_KEY = 'ComfyTV.AgentPanel.discovered'

type WorkflowTargetSelection =
  | { status: 'cleared' }
  | { status: 'selected'; workflow: ComfyWorkflow }

export const useAgentPanelStore = defineStore('agentPanel', () => {
  const enabled = ref(false)
  const consentAccepted = ref(true)
  const gateSettled = ref(true)
  const isOpen = useLocalStorage(OPEN_STORAGE_KEY, false, { writeDefaults: false })
  const hasEverOpened = useLocalStorage(DISCOVERED_STORAGE_KEY, false, {
    writeDefaults: false,
  })
  const width = useLocalStorage(WIDTH_STORAGE_KEY, PANEL_MIN_WIDTH, {
    writeDefaults: false,
  })
  const dismissedSelectionSignature = ref<string | null>(null)

  const isVisible = computed(
    () => enabled.value && isOpen.value && consentAccepted.value,
  )
  watch(
    isVisible,
    (visible) => {
      if (visible) hasEverOpened.value = true
    },
    { immediate: true },
  )

  const workflowStore = useWorkflowStore()
  const selectedWorkflow = computed<ComfyWorkflow | null>(
    () => workflowStore.activeWorkflow,
  )
  const workflowTargetSelection = computed<WorkflowTargetSelection>(() =>
    selectedWorkflow.value
      ? { status: 'selected', workflow: selectedWorkflow.value }
      : { status: 'cleared' },
  )
  const canRestoreWorkflow = computed(() => false)

  function resetWorkflowTarget(): void {}
  function setWorkflowTarget(_workflow: ComfyWorkflow | null): void {}

  const isMaximized = computed(() => width.value === PANEL_MAX_WIDTH)

  function open(_source?: string): void {
    isOpen.value = true
  }
  function close(_source: AgentPanelCloseSource = 'other'): void {
    isOpen.value = false
  }
  function suppressRestoredOpen(): void {
    if (!isOpen.value || isVisible.value) return
    isOpen.value = false
  }
  function toggle(): void {
    isOpen.value = !isOpen.value
  }
  function setWidth(value: number): void {
    width.value = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, value))
  }
  function toggleMaximize(): void {
    setWidth(isMaximized.value ? PANEL_MIN_WIDTH : PANEL_MAX_WIDTH)
  }

  return {
    enabled,
    consentAccepted,
    isOpen,
    isVisible,
    hasEverOpened,
    gateSettled,
    width,
    isMaximized,
    dismissedSelectionSignature,
    open,
    workflowTargetSelection,
    selectedWorkflow,
    canRestoreWorkflow,
    resetWorkflowTarget,
    setWorkflowTarget,
    toggle,
    close,
    suppressRestoredOpen,
    setWidth,
    toggleMaximize,
  }
})
