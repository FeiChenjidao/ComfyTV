<script setup lang="ts">
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger
} from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { totalDurationMs } from '../../../services/agent/agentActivityRows'
import type { ActivityPart } from '../../../services/agent/agentMessageParts'
import {
  MS_PER_MINUTE,
  splitMinutes,
  tenthsOfSecond
} from '../../../utils/formatDuration'

import ActivityTrace from './ActivityTrace.vue'

const { parts } = defineProps<{ parts: readonly ActivityPart[] }>()

const { t } = useI18n()

const totalMs = computed(() => totalDurationMs(parts))

const label = computed(() => {
  if (totalMs.value <= 0) return t('agent.worked')
  if (totalMs.value < MS_PER_MINUTE)
    return t('agent.workedForSeconds', {
      seconds: tenthsOfSecond(totalMs.value)
    })
  return t('agent.workedForMinutes', splitMinutes(totalMs.value))
})
</script>

<template>
  <CollapsibleRoot>
    <CollapsibleTrigger
      class="ctv:group ctv:flex ctv:h-8 ctv:w-full ctv:cursor-pointer ctv:items-center ctv:gap-2 ctv:rounded-lg ctv:px-2 ctv:text-sm ctv:leading-none ctv:font-normal ctv:text-muted-foreground ctv:transition-colors ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground"
    >
      <span class="ctv:text-left">{{ label }}</span>
      <span
        class="ctv:icon-[lucide--chevron-down] ctv:size-4 ctv:shrink-0 ctv:transition-transform ctv:group-data-[state=open]:rotate-180"
      />
    </CollapsibleTrigger>
    <CollapsibleContent class="agent-work-summary ctv:overflow-hidden">
      <ActivityTrace :parts />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
