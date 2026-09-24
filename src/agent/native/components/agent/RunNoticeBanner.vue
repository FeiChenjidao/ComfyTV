<script setup lang="ts">
import { useStorage } from '@vueuse/core'

import Button from '@agent/components/ui/button/Button.vue'

const { expanded = false, workflowName } = defineProps<{
  expanded?: boolean
  workflowName?: string
}>()

const dismissed = useStorage('ComfyTV.AgentPanel.runNoticeDismissed', false)
</script>

<template>
  <div
    v-if="!dismissed"
    role="note"
    class="ctv:relative ctv:flex ctv:items-start ctv:gap-2 ctv:overflow-hidden ctv:rounded-lg ctv:bg-base-background ctv:p-4 ctv:ring-1 ctv:ring-border-subtle ctv:before:absolute ctv:before:inset-y-0 ctv:before:left-0 ctv:before:w-1 ctv:before:bg-primary-background"
  >
    <span
      class="ctv:icon-[heroicons--information-circle-20-solid] ctv:size-5 ctv:shrink-0 ctv:text-primary-background"
    />
    <p class="ctv:my-0 ctv:min-w-0 ctv:flex-1 ctv:text-sm ctv:font-medium ctv:text-base-foreground">
      <i18n-t v-if="workflowName" keypath="agent.workflowEditNotice" tag="span">
        <template #workflow>
          <span class="ctv:underline ctv:decoration-solid">{{ workflowName }}</span>
        </template>
      </i18n-t>
      <template v-else>
        {{ $t(expanded ? 'agent.runNoticeExpanded' : 'agent.runNotice') }}
      </template>
    </p>
    <Button
      type="button"
      variant="muted-textonly"
      size="icon-sm"
      :aria-label="$t('agent.dismiss')"
      class="ctv:shrink-0"
      @click="dismissed = true"
    >
      <span class="ctv:icon-[lucide--x] ctv:size-5" />
    </Button>
  </div>
</template>
