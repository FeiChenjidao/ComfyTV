<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'
import Button from '@agent/components/ui/button/Button.vue'
import AccessibleTooltip from '@agent/components/ui/tooltip/AccessibleTooltip.vue'
import { useAssetDownload } from '@agent/platform/assets/composables/useAssetDownload'
import { renderMarkdownToHtml } from '@agent/utils/markdownRendererUtil'
import { resolveReplyAssetDownload } from '../../../utils/resolveReplyAssetDownload'
import type { ReplyAsset } from '../../../utils/replyAssets'

const { markdown, assets = [] } = defineProps<{
  markdown: string
  assets?: ReplyAsset[]
}>()
const emit = defineEmits<{ feedback: [vote: 'up' | 'down' | null] }>()

const { t } = useI18n()
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })
const { downloadFiles } = useAssetDownload()

function copyPlainText(): void {
  const doc = new DOMParser().parseFromString(
    renderMarkdownToHtml(markdown),
    'text/html'
  )
  void copy(doc.body.textContent?.trim() ?? '')
}

const downloading = ref(false)

async function downloadAssets(): Promise<void> {
  if (downloading.value) return
  downloading.value = true
  try {
    await downloadFiles(
      await Promise.all(assets.map(resolveReplyAssetDownload))
    )
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <div
    class="ctv:flex ctv:w-full ctv:items-center ctv:justify-start ctv:gap-1 ctv:text-muted-foreground"
  >
    <AccessibleTooltip
      v-if="assets.length"
      :label="t('agent.downloadAssets')"
      :skip-delay-duration="0"
      disable-hoverable-content
      :collision-padding="8"
    >
      <template #trigger>
        <Button
          type="button"
          variant="muted-textonly"
          size="icon-sm"
          :aria-label="t('agent.downloadAssets')"
          :disabled="downloading"
          class="ctv:size-6 ctv:rounded-lg"
          @click="downloadAssets"
        >
          <span class="ctv:icon-[lucide--download] ctv:size-3" />
        </Button>
      </template>
    </AccessibleTooltip>
    <div
      class="ctv:flex ctv:h-6 ctv:w-14 ctv:rounded-lg ctv:transition-colors ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground ctv:has-data-[state=open]:bg-secondary-background-hover ctv:has-data-[state=open]:text-base-foreground"
    >
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
            size="unset"
            :aria-label="copied ? t('agent.copied') : t('agent.copy')"
            :class="
              cn(
                'ctv:h-6 ctv:w-8 ctv:rounded-l-lg ctv:rounded-r-none ctv:focus-visible:z-10',
                copied ? 'ctv:text-base-foreground' : 'ctv:text-inherit'
              )
            "
            @click="copyPlainText()"
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
      <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
          <Button
            variant="muted-textonly"
            size="icon-sm"
            :aria-label="t('agent.copyMarkdown')"
            class="ctv:size-6 ctv:rounded-l-none ctv:rounded-r-lg ctv:text-inherit ctv:focus-visible:z-10"
          >
            <span class="ctv:icon-[lucide--chevron-down] ctv:size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            align="end"
            :side-offset="4"
            class="ctv:z-1100 ctv:h-9 ctv:w-36 ctv:rounded-lg ctv:border ctv:border-border-subtle ctv:bg-secondary-background ctv:p-1 ctv:shadow-lg"
          >
            <DropdownMenuItem
              class="ctv:flex ctv:h-7 ctv:w-full ctv:cursor-pointer ctv:items-center ctv:rounded-lg ctv:px-1.5 ctv:text-[14px]/5 ctv:font-normal ctv:whitespace-nowrap ctv:text-base-foreground ctv:outline-none ctv:data-highlighted:bg-secondary-background-hover"
              @select="copy(markdown)"
            >
              {{ t('agent.copyMarkdown') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
  </div>
</template>
