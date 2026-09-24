<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'

import Button from '@agent/components/ui/button/Button.vue'
import { buildTooltipConfig } from '@agent/composables/useTooltipConfig'
import { reportError } from '@agent/platform/telemetry/reportError'
import { useToastStore } from '@agent/platform/updates/common/toastStore'

import type { AgentRunModeValue } from '../../../stores/agent/agentRunModeStore'
import { useAgentRunModeStore } from '../../../stores/agent/agentRunModeStore'

const { t } = useI18n()
const store = useAgentRunModeStore()
const toast = useToastStore()

const open = ref(false)
const savingMode = ref<AgentRunModeValue | null>(null)
const descriptionId = useId()
let openCount = 0

function onOpenChange(next: boolean): void {
  open.value = next
  if (next) openCount += 1
}

async function onSelectMode(value: string): Promise<void> {
  const match = options.find((option) => option.mode === value)
  if (!match || savingMode.value !== null) return

  const openedAs = openCount
  savingMode.value = match.mode
  try {
    await store.save(match.mode, null)
    if (openedAs === openCount) open.value = false
  } catch (error) {
    reportError(error, { errorType: 'agent_run_mode_save_failure' })
    toast.add({ severity: 'error', detail: t('agent.runModeSaveFailed') })
  } finally {
    savingMode.value = null
  }
}

const TRIGGER_LABEL_KEYS: Record<AgentRunModeValue, string> = {
  ask_approval: 'agent.runModeTriggerAsk',
  auto: 'agent.runModeTriggerAuto',
  auto_limited: 'agent.runModeTriggerAutoLimit'
}

const triggerLabel = computed(() => t(TRIGGER_LABEL_KEYS[store.mode]))

const TRIGGER_TOOLTIP_KEYS: Record<AgentRunModeValue, string> = {
  ask_approval: 'agent.runModeTriggerAskTooltip',
  auto: 'agent.runModeTriggerAutoTooltip',
  auto_limited: 'agent.runModeTriggerAutoLimitTooltip'
}

const triggerTooltip = computed(() => t(TRIGGER_TOOLTIP_KEYS[store.mode]))

const options: {
  mode: AgentRunModeValue
  icon: string
  title: string
  description: string
}[] = [
  {
    mode: 'ask_approval',
    icon: 'ctv:icon-[lucide--hand]',
    title: 'agent.runModeAsk',
    description: 'agent.runModeAskDescription'
  },
  {
    mode: 'auto',
    icon: 'ctv:icon-[lucide--zap]',
    title: 'agent.runModeAuto',
    description: 'agent.runModeAutoDescription'
  }
]
</script>

<template>
  <DropdownMenuRoot :open :modal="false" @update:open="onOpenChange">
    <DropdownMenuTrigger as-child>
      <Button
        v-tooltip.top="buildTooltipConfig(triggerTooltip)"
        variant="muted-textonly"
        size="md"
        :class="cn('ctv:gap-1', open && 'ctv:bg-secondary-background-hover')"
      >
        <span>{{ triggerLabel }}</span>
        <span
          data-testid="run-mode-chevron"
          class="ctv:icon-[lucide--chevron-down] ctv:size-4"
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        side="top"
        align="end"
        :side-offset="8"
        :aria-describedby="descriptionId"
        class="agent-scope ctv:z-1100 ctv:flex ctv:w-80 ctv:flex-col ctv:gap-2.5 ctv:rounded-lg ctv:border ctv:border-border-default ctv:bg-secondary-background ctv:p-2.5 ctv:text-base-foreground ctv:shadow-lg ctv:outline-none ctv:data-[side=bottom]:slide-in-from-top-2 ctv:data-[side=top]:slide-in-from-bottom-2 ctv:data-[state=closed]:animate-out ctv:data-[state=closed]:fade-out-0 ctv:data-[state=closed]:zoom-out-95 ctv:data-[state=open]:animate-in ctv:data-[state=open]:fade-in-0 ctv:data-[state=open]:zoom-in-95"
      >
        <div class="ctv:flex ctv:flex-col ctv:gap-0.5">
          <div
            aria-hidden="true"
            class="ctv:text-sm/5 ctv:font-medium ctv:text-base-foreground"
          >
            {{ t('agent.runPermissions') }}
          </div>
          <div
            :id="descriptionId"
            aria-hidden="true"
            class="ctv:text-xs/4 ctv:text-muted-foreground"
          >
            {{ t('agent.runPermissionsDescription') }}
          </div>
        </div>

        <DropdownMenuRadioGroup
          :model-value="store.mode"
          :aria-label="t('agent.runPermissions')"
          class="ctv:flex ctv:flex-col ctv:gap-1"
          @update:model-value="(value) => onSelectMode(String(value))"
        >
          <DropdownMenuRadioItem
            v-for="option in options"
            :key="option.mode"
            :value="option.mode"
            :disabled="savingMode !== null"
            :aria-busy="savingMode === option.mode || undefined"
            as-child
            @select.prevent
          >
            <Button
              :variant="
                store.mode === option.mode ? 'tertiary' : 'muted-textonly'
              "
              size="unset"
              :class="
                cn(
                  'ctv:w-full ctv:items-start ctv:gap-3 ctv:px-2.5 ctv:py-2 ctv:text-left ctv:whitespace-normal ctv:data-disabled:pointer-events-none',
                  savingMode !== null &&
                    savingMode !== option.mode &&
                    'ctv:opacity-50'
                )
              "
            >
              <span
                :class="
                  cn(
                    'ctv:mt-0.5 ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground',
                    option.icon
                  )
                "
              />
              <span class="ctv:min-w-0 ctv:flex-1">
                <span class="ctv:block ctv:text-sm/5 ctv:text-base-foreground">
                  {{ t(option.title) }}
                </span>
                <span class="ctv:mt-0.5 ctv:block ctv:text-xs/4 ctv:text-muted-foreground">
                  {{ t(option.description) }}
                </span>
              </span>
              <span
                aria-hidden="true"
                :class="
                  cn(
                    'ctv:mt-0.5 ctv:size-4 ctv:shrink-0',
                    savingMode === option.mode
                      ? 'ctv:icon-[lucide--loader-circle] ctv:text-muted-foreground ctv:motion-safe:animate-spin'
                      : store.mode === option.mode &&
                          'ctv:icon-[lucide--check] ctv:text-base-foreground'
                  )
                "
              />
            </Button>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
      <span v-if="open" role="status" class="ctv:sr-only">
        {{ savingMode === null ? '' : t('g.saving') }}
      </span>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
