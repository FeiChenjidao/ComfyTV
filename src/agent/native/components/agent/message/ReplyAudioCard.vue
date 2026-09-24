<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import Slider from '@agent/components/ui/slider/Slider.vue'
import Button from '@agent/components/ui/button/Button.vue'
import { useWaveAudioPlayer } from '@agent/composables/useWaveAudioPlayer'
import { useAssetDownload } from '@agent/platform/assets/composables/useAssetDownload'
import { cn } from '@comfyorg/tailwind-utils'

import { resolveReplyAssetDownload } from '../../../utils/resolveReplyAssetDownload'
import type { ReplyAsset } from '../../../utils/replyAssets'

const { asset, title } = defineProps<{ asset: ReplyAsset; title: string }>()

const { t } = useI18n()
const { downloadFiles } = useAssetDownload()

const {
  audioRef,
  isPlaying,
  progressRatio,
  formattedCurrentTime,
  formattedDuration,
  togglePlayPause,
  muted,
  volumeIcon,
  toggleMute,
  seekToRatio
} = useWaveAudioPlayer({ src: toRef(() => asset.url), waveform: false })

function onScrub(value: number[] | undefined): void {
  if (value?.length) seekToRatio(value[0] / 100)
}

async function download(): Promise<void> {
  await downloadFiles([await resolveReplyAssetDownload(asset)])
}
</script>

<template>
  <div
    class="group/audio ctv:flex ctv:w-full ctv:items-center ctv:gap-2.5 ctv:rounded-lg ctv:border ctv:border-component-node-border ctv:px-3 ctv:py-2.5"
  >
    <audio
      :ref="(el) => (audioRef = el as HTMLAudioElement)"
      data-testid="reply-audio-element"
      class="ctv:hidden"
      :src="asset.url"
      preload="metadata"
    />
    <Button
      type="button"
      variant="secondary"
      size="icon-lg"
      :aria-label="isPlaying ? t('g.pause') : t('g.play')"
      class="ctv:shrink-0"
      @click="togglePlayPause"
    >
      <span
        :class="
          cn(
            'ctv:size-4',
            isPlaying ? 'ctv:icon-[lucide--pause]' : 'ctv:icon-[lucide--play]'
          )
        "
      />
    </Button>
    <div class="ctv:flex ctv:min-w-0 ctv:flex-1 ctv:flex-col">
      <span class="ctv:truncate ctv:text-sm/4 ctv:font-medium ctv:text-base-foreground">{{
        title
      }}</span>
      <div class="ctv:flex ctv:h-6 ctv:items-center ctv:gap-4">
        <span
          class="ctv:text-xs ctv:whitespace-nowrap ctv:text-muted-foreground ctv:tabular-nums"
        >
          {{ formattedCurrentTime }} / {{ formattedDuration }}
        </span>
        <Slider
          class="ctv:min-w-0 ctv:flex-1"
          thumb-class="ctv:opacity-0 ctv:transition-opacity ctv:group-hover/audio:opacity-100 ctv:focus-visible:opacity-100"
          :model-value="[progressRatio]"
          :max="100"
          :step="0.1"
          @update:model-value="onScrub"
        />
        <div class="ctv:flex ctv:shrink-0 ctv:items-center ctv:gap-2">
          <Button
            type="button"
            variant="muted-textonly"
            size="icon-sm"
            :aria-label="muted ? t('g.unmute') : t('g.mute')"
            class="ctv:size-6 ctv:rounded-lg"
            @click="toggleMute"
          >
            <span :class="cn('ctv:size-4', volumeIcon)" />
          </Button>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon-sm"
            :aria-label="t('g.download')"
            class="ctv:size-6 ctv:rounded-lg"
            @click="download"
          >
            <span class="ctv:icon-[lucide--download] ctv:size-4" />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
