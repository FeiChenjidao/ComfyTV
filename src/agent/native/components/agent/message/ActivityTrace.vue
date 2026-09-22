<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'

import type { ActivityRow } from '../../../services/agent/agentActivityRows'
import { foldActivity } from '../../../services/agent/agentActivityRows'
import type {
  ActivityPart,
  PartState
} from '../../../services/agent/agentMessageParts'
import { toolGlyph, toolLabel } from '../../../services/agent/agentToolGlyph'
import { formatDurationCompact } from '../../../utils/formatDuration'

const { parts, live = false } = defineProps<{
  parts: readonly ActivityPart[]
  /** The turn is still running, so a newly mounted row is a real arrival. */
  live?: boolean
}>()

const { t } = useI18n()

const rows = computed(() => foldActivity(parts))

const LABEL = 'ctv:text-muted-foreground ctv:min-w-0 ctv:text-sm/5'
const LABEL_STREAMING = `${LABEL} agent-shimmer-text`

function labelClass(state: PartState): string {
  return state === 'streaming' ? LABEL_STREAMING : LABEL
}

function glyphOf(row: ActivityRow): string {
  return row.kind === 'thinking'
    ? 'ctv:icon-[lucide--brain]'
    : toolGlyph(row.name, row.state, row.ok)
}

// Every part object is rebuilt on each token, so a settled row is only
// recognisable as unchanged by its contents.
function rowSignature(row: ActivityRow): string {
  return row.kind === 'tool'
    ? `tool:${row.name}:${row.state}:${row.ok}:${row.count}:${row.durationMs}`
    : `think:${row.state}:${row.durationMs}:${row.text}`
}
</script>

<template>
  <div role="list" class="ctv:flex ctv:flex-col">
    <div
      v-for="(row, index) in rows"
      :key="index"
      v-memo="[rowSignature(row), index === rows.length - 1, live]"
      role="listitem"
      :class="cn('ctv:flex ctv:gap-2 ctv:px-2', live && 'agent-row-enter')"
    >
      <div class="ctv:flex ctv:w-4 ctv:shrink-0 ctv:flex-col ctv:items-center">
        <span
          :class="
            cn('ctv:mt-0.5 ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground', glyphOf(row))
          "
        />
        <span
          v-if="index < rows.length - 1"
          class="ctv:mt-1 ctv:w-px ctv:flex-1 ctv:bg-component-node-border"
        />
      </div>
      <div class="ctv:flex ctv:min-w-0 ctv:flex-1 ctv:items-start ctv:gap-2 ctv:pb-3">
        <span
          v-if="row.kind === 'thinking'"
          :class="
            cn(labelClass(row.state), 'ctv:wrap-break-word ctv:whitespace-pre-wrap')
          "
          >{{ row.text || t('agent.thinking') }}</span
        >
        <template v-else>
          <span :class="labelClass(row.state)">{{
            toolLabel(row.name, row.state, t)
          }}</span>
          <span
            v-if="row.count > 1"
            class="ctv:mt-0.5 ctv:shrink-0 ctv:text-xs ctv:text-muted-foreground"
            >×{{ row.count }}</span
          >
        </template>
        <span
          v-if="row.durationMs !== undefined"
          class="ctv:mt-0.5 ctv:ml-auto ctv:shrink-0 ctv:font-mono ctv:text-xs/4 ctv:text-muted-foreground"
          >{{ formatDurationCompact(row.durationMs) }}</span
        >
      </div>
    </div>
  </div>
</template>
