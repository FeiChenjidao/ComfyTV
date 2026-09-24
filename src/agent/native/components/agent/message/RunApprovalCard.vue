<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@agent/components/ui/button/Button.vue'

import type { RunApprovalPart } from '../../../services/agent/agentMessageParts'

const { part, answering = false } = defineProps<{
  part: RunApprovalPart
  answering?: boolean
}>()
const emit = defineEmits<{
  answer: [askId: string, selection: 'run' | 'cancel']
  openWorkflow: [workflowId: string, workflowName?: string]
}>()

const { t } = useI18n()
const workflowLabel = computed(
  () =>
    part.workflowName?.trim() ||
    part.workflowId?.trim() ||
    t('agent.runApproval.thisWorkflow')
)
</script>

<template>
  <div
    class="ctv:flex ctv:w-full ctv:flex-col ctv:gap-2 ctv:overflow-hidden ctv:rounded-lg ctv:border ctv:border-component-node-border ctv:bg-secondary-background ctv:p-4 ctv:shadow-interface"
  >
    <div class="ctv:flex ctv:min-w-0 ctv:flex-col ctv:gap-0.5 ctv:text-sm/5">
      <p class="ctv:m-0 ctv:font-medium ctv:text-base-foreground">
        {{ t('agent.runApproval.lead') }}
      </p>
      <ul class="ctv:m-0 ctv:min-w-0 ctv:list-disc ctv:pl-5 ctv:text-muted-foreground">
        <li>
          <Button
            v-if="part.workflowId"
            type="button"
            variant="link"
            size="unset"
            class="ctv:max-w-full ctv:justify-start ctv:text-left ctv:font-normal ctv:wrap-break-word ctv:whitespace-normal ctv:text-inherit ctv:underline ctv:underline-offset-2"
            @click="emit('openWorkflow', part.workflowId, part.workflowName)"
          >
            {{ workflowLabel }}
          </Button>
          <span v-else class="ctv:wrap-break-word ctv:underline ctv:underline-offset-2">
            {{ workflowLabel }}
          </span>
        </li>
      </ul>
      <p class="ctv:m-0 ctv:text-muted-foreground">
        {{ t('agent.runApproval.question') }}
      </p>
    </div>

    <div class="ctv:flex ctv:h-6 ctv:w-full ctv:justify-end ctv:gap-2">
      <Button
        variant="secondary"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', part.askId, 'cancel')"
      >
        {{ t('agent.runApproval.cancel') }}
      </Button>
      <Button
        variant="primary"
        size="sm"
        :disabled="answering"
        :aria-busy="answering || undefined"
        @click="emit('answer', part.askId, 'run')"
      >
        {{ t('agent.runApproval.run') }}
      </Button>
    </div>
  </div>
</template>
