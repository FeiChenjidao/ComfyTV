<script setup lang="ts">
import { useClipboard, useClipboardItems } from '@vueuse/core'
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'
import Button from '@agent/components/ui/button/Button.vue'
import AccessibleTooltip from '@agent/components/ui/tooltip/AccessibleTooltip.vue'
import { iconForMediaType } from '@agent/platform/assets/utils/mediaIconUtil'
import { api } from '@agent/scripts/api'
import { getMediaTypeFromFilename } from '@agent/utils/formatUtil'

import type { UserAttachment } from '../../../stores/agent/agentConversationStore'
import type {
  PromptSnapshot,
  WorkflowReference
} from '../../../types/workflowReference'
import type { ReplyAsset } from '../../../utils/replyAssets'
import { agentMessageText } from '../../../utils/agentMessageText'
import { workflowReferenceParts } from '../../../utils/workflowReferenceParts'
import ReplyAssetGroup from './ReplyAssetGroup.vue'
import {
  selectedUserMessageClipboard,
  userMessageClipboard
} from './userMessageClipboard'

const {
  text,
  attachments = [],
  tags = [],
  workflowReferences = [],
  editable = false
} = defineProps<{
  text: string
  attachments?: UserAttachment[]
  tags?: string[]
  workflowReferences?: WorkflowReference[]
  editable?: boolean
}>()
const emit = defineEmits<{
  edit: [prompt: PromptSnapshot]
  openReferenceWorkflow: [workflowId: string, workflowName: string]
}>()

const { t } = useI18n()
const promptParts = computed(() =>
  workflowReferenceParts(text, workflowReferences)
)
const readableText = computed(() =>
  agentMessageText({ text, workflowReferences, tags, attachments })
)
const bubble = useTemplateRef<HTMLElement>('bubble')
const plainClipboard = useClipboard({ copiedDuring: 2000, legacy: true })
const richClipboard = useClipboardItems({ copiedDuring: 2000 })
const copied = computed(
  () => plainClipboard.copied.value || richClipboard.copied.value
)

async function copyMessage(): Promise<void> {
  if (
    workflowReferences.length &&
    richClipboard.isSupported.value &&
    typeof ClipboardItem !== 'undefined'
  ) {
    const content = userMessageClipboard({
      text,
      workflowReferences,
      tags,
      attachments
    })
    try {
      await richClipboard.copy([
        new ClipboardItem({
          'text/plain': new Blob([content.text], { type: 'text/plain' }),
          'text/html': new Blob([content.html], { type: 'text/html' })
        })
      ])
      return
    } catch {
      await plainClipboard.copy(content.text)
      return
    }
  }
  await plainClipboard.copy(readableText.value)
}

function copySelection(event: ClipboardEvent): void {
  if (!bubble.value || !event.clipboardData) return
  const content = selectedUserMessageClipboard(
    bubble.value,
    document.getSelection()
  )
  if (!content) return
  event.clipboardData.setData('text/plain', content.text)
  event.clipboardData.setData('text/html', content.html)
  event.preventDefault()
  event.stopPropagation()
}

function openReference(reference: WorkflowReference): void {
  if (reference.unavailable) return
  emit('openReferenceWorkflow', reference.id, reference.name)
}

/* The shared map's 'other' glyph is a checkmark, which reads as a status
   rather than a file on this surface. */
function attachmentIconClass(name: string): string {
  const kind = getMediaTypeFromFilename(name)
  return kind === 'other' ? 'ctv:icon-[lucide--file]' : iconForMediaType(kind)
}

/**
 * Sent uploads reuse the reply asset grid (Uy, FE-1323): media attachments
 * render as the DES-530 per-count grid with the same hover-play, inspect, and
 * audio-card behavior as agent replies. A ref resolves to the uploaded input
 * file; an image without one still has its local preview. Text and other
 * kinds have no grid treatment and keep the compact tiles.
 */
const splitAttachments = computed(() => {
  const grid: ReplyAsset[] = []
  const plain: UserAttachment[] = []
  for (const item of attachments) {
    const kind = getMediaTypeFromFilename(item.name)
    const url =
      item.previewUrl ??
      (item.ref
        ? api.apiURL(
            `/view?filename=${encodeURIComponent(item.ref)}&type=input`
          )
        : undefined)
    if (
      url &&
      (kind === 'image' ||
        kind === 'video' ||
        kind === 'audio' ||
        kind === '3D')
    ) {
      grid.push({ url, filename: item.name, kind })
    } else {
      plain.push(item)
    }
  }
  return { grid, plain }
})
</script>

<template>
  <div class="ctv:group ctv:flex ctv:flex-col ctv:items-end ctv:gap-2 ctv:pl-16" @copy="copySelection">
    <div v-if="tags.length" class="ctv:flex ctv:flex-wrap ctv:justify-end ctv:gap-1">
      <span
        v-for="(tag, index) in tags"
        :key="`${tag}:${index}`"
        class="ctv:inline-flex ctv:items-center ctv:gap-1 ctv:rounded-xl ctv:bg-secondary-background ctv:px-1.5 ctv:py-0.5 ctv:text-xs ctv:text-muted-foreground"
      >
        <span class="ctv:icon-[lucide--at-sign] ctv:size-3 ctv:shrink-0" />
        <span class="ctv:max-w-40 ctv:truncate">{{ tag }}</span>
      </span>
    </div>
    <div v-if="splitAttachments.grid.length" class="ctv:w-full">
      <ReplyAssetGroup :assets="splitAttachments.grid" />
    </div>
    <div
      v-if="splitAttachments.plain.length"
      class="ctv:grid ctv:w-56 ctv:max-w-full ctv:grid-cols-2 ctv:gap-1.5"
    >
      <figure
        v-for="(item, index) in splitAttachments.plain"
        :key="`${item.name}:${index}`"
        class="ctv:m-0"
      >
        <div
          class="ctv:flex ctv:aspect-square ctv:w-full ctv:items-center ctv:justify-center ctv:rounded-lg ctv:bg-secondary-background"
        >
          <span
            :class="
              cn(attachmentIconClass(item.name), 'ctv:size-6 ctv:text-muted-foreground')
            "
          />
        </div>
        <figcaption class="ctv:mt-0.5 ctv:truncate ctv:text-xs ctv:text-muted-foreground">
          {{ item.name }}
        </figcaption>
      </figure>
    </div>
    <div
      v-if="text || workflowReferences.length"
      ref="bubble"
      data-testid="user-message-bubble"
      class="ctv:w-fit ctv:max-w-full ctv:rounded-lg ctv:border ctv:border-component-node-border ctv:bg-secondary-background ctv:px-2.5 ctv:py-1.5 ctv:text-sm/5 ctv:font-normal ctv:wrap-break-word ctv:whitespace-pre-wrap ctv:text-muted-foreground"
    >
      <template v-for="(part, index) in promptParts" :key="index">
        <span
          v-if="part.type === 'workflow'"
          role="button"
          tabindex="0"
          :aria-label="
            part.reference.unavailable
              ? t('agent.unavailableWorkflowReference', {
                  name: part.reference.name
                })
              : t('agent.openWorkflowTab', { name: part.reference.name })
          "
          data-testid="workflow-reference-chip"
          data-comfy-workflow="1"
          :data-workflow-id="part.reference.id"
          :data-workflow-unavailable="
            part.reference.unavailable ? 'true' : undefined
          "
          :aria-disabled="part.reference.unavailable"
          :aria-description="
            part.reference.unavailable
              ? t('agent.workflowReferenceUnavailableReason')
              : undefined
          "
          :title="
            part.reference.unavailable
              ? t('agent.workflowReferenceUnavailableReason')
              : undefined
          "
          class="ctv:inline ctv:cursor-pointer ctv:rounded-sm ctv:bg-primary-background/30 ctv:box-decoration-clone ctv:px-1 ctv:py-0.5 ctv:font-inter ctv:text-xs/[15px] ctv:font-normal ctv:break-all ctv:whitespace-normal ctv:text-primary-background-hover ctv:ring-1 ctv:ring-primary-background/30 ctv:ring-inset ctv:focus-visible:outline-2 ctv:focus-visible:outline-offset-2 ctv:focus-visible:outline-primary-background ctv:aria-disabled:cursor-not-allowed ctv:aria-disabled:opacity-50"
          @click="openReference(part.reference)"
          @keydown.enter.prevent="openReference(part.reference)"
          @keydown.space.prevent
          @keyup.space.prevent="openReference(part.reference)"
        >
          <span
            class="ctv:mr-1 ctv:icon-[comfy--workflow] ctv:inline-block ctv:size-3 ctv:align-middle"
          />
          <span>{{ part.reference.name }}</span>
        </span>
        <template v-else>{{ part.text }}</template>
      </template>
    </div>
    <div
      v-if="readableText"
      class="ctv:flex ctv:text-muted-foreground ctv:opacity-0 ctv:transition-opacity ctv:group-hover:opacity-100 ctv:focus-within:opacity-100 ctv:touch:opacity-100"
    >
      <AccessibleTooltip
        v-if="editable && (text || workflowReferences.length)"
        :label="t('g.edit')"
        :skip-delay-duration="0"
        disable-hoverable-content
        :collision-padding="8"
      >
        <template #trigger>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon-sm"
            :aria-label="t('g.edit')"
            class="ctv:size-6 ctv:rounded-lg"
            @click="emit('edit', { text, workflowReferences })"
          >
            <span class="ctv:icon-[lucide--pencil] ctv:size-3" />
          </Button>
        </template>
      </AccessibleTooltip>
      <AccessibleTooltip
        :label="copied ? t('agent.copied') : t('agent.copy')"
        :skip-delay-duration="0"
        disable-hoverable-content
        :collision-padding="8"
      >
        <template #trigger>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon-sm"
            :aria-label="copied ? t('agent.copied') : t('agent.copy')"
            class="ctv:size-6 ctv:rounded-lg"
            @click="copyMessage"
          >
            <span
              :class="
                cn(
                  'ctv:size-3',
                  copied ? 'ctv:icon-[lucide--check]' : 'ctv:icon-[lucide--copy]'
                )
              "
            />
          </Button>
        </template>
      </AccessibleTooltip>
    </div>
  </div>
</template>
