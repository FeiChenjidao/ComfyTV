<script setup lang="ts">
import { createReusableTemplate, useResizeObserver } from '@vueuse/core'
import { computed, ref } from 'vue'

import Button from '@agent/components/ui/button/Button.vue'

const {
  title,
  titleId,
  paragraphs,
  videoSrc = '',
  videoSrcMp4 = '',
  posterSrc = '',
  docsUrl = '',
  accepting = false,
  error = ''
} = defineProps<{
  title: string
  titleId?: string
  paragraphs: string[]
  videoSrc?: string
  videoSrcMp4?: string
  posterSrc?: string
  docsUrl?: string
  accepting?: boolean
  error?: string
}>()

const emit = defineEmits<{
  reject: []
  accept: []
}>()

const CONTAINER_XL_MIN_WIDTH = 576
const [DefineDocsLink, ReuseDocsLink] = createReusableTemplate()
const containerRef = ref<HTMLElement>()
const isWide = ref(false)
const videoFailed = ref(false)
const actions = computed(() => {
  if (accepting) return ['accept'] as const
  return isWide.value
    ? (['reject', 'accept'] as const)
    : (['accept', 'reject'] as const)
})

useResizeObserver(containerRef, ([entry]) => {
  isWide.value = entry.contentRect.width >= CONTAINER_XL_MIN_WIDTH
})

function choose(action: 'accept' | 'reject'): void {
  if (action === 'accept') emit('accept')
  else emit('reject')
}
</script>

<template>
  <DefineDocsLink>
    <Button
      variant="link"
      size="unset"
      class="ctv:mr-auto ctv:w-fit ctv:gap-1 ctv:px-0 ctv:py-2 ctv:text-sm/5 ctv:font-normal ctv:hover:underline"
      as="a"
      :href="docsUrl"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ $t('agent.consent.readDocs') }}
      <span class="ctv:icon-[lucide--square-arrow-out-up-right] ctv:size-4" />
    </Button>
  </DefineDocsLink>

  <div ref="containerRef" class="ctv:dark-theme @container ctv:w-full ctv:max-w-[640px]">
    <div
      data-testid="agent-consent-card"
      class="ctv:max-h-[85dvh] ctv:overflow-y-auto ctv:rounded-2xl ctv:border ctv:border-component-node-border ctv:bg-base-background ctv:shadow-[0_20px_24px_-4px_rgba(10,13,18,0.4),0_8px_8px_-4px_rgba(10,13,18,0.25),0_3px_3px_-1.5px_rgba(10,13,18,0.2)]"
    >
      <div class="ctv:p-2">
        <video
          v-if="videoSrc && !videoFailed"
          data-testid="agent-consent-video"
          class="ctv:aspect-video ctv:w-full ctv:rounded-lg ctv:object-cover"
          :poster="posterSrc || undefined"
          autoplay
          muted
          loop
          playsinline
          @error="videoFailed = true"
        >
          <source
            :src="videoSrc"
            type="video/webm"
            @error="videoFailed = !videoSrcMp4"
          />
          <source
            v-if="videoSrcMp4"
            :src="videoSrcMp4"
            type="video/mp4"
            @error="videoFailed = true"
          />
        </video>
        <div
          v-else
          class="ctv:grid ctv:aspect-video ctv:w-full ctv:place-items-center ctv:rounded-lg ctv:bg-secondary-background ctv:text-xs ctv:text-muted-foreground"
        >
          {{ $t('agent.consent.videoPlaceholder') }}
        </div>
      </div>

      <section class="ctv:flex ctv:flex-col ctv:gap-9 ctv:p-6 @xl:gap-6 @xl:p-9">
        <div class="ctv:flex ctv:flex-col ctv:gap-4">
          <h2
            :id="titleId"
            class="ctv:my-0 ctv:text-xl ctv:font-semibold ctv:text-base-foreground @xl:text-2xl"
          >
            {{ title }}
          </h2>
          <p
            v-for="(paragraph, index) in paragraphs"
            :key="index"
            class="ctv:my-0 ctv:text-sm/5 ctv:text-muted-foreground"
          >
            {{ paragraph }}
          </p>

          <ReuseDocsLink v-if="docsUrl && !isWide" />

          <p
            v-if="error"
            role="alert"
            class="ctv:my-0 ctv:text-sm/5 ctv:text-destructive-background"
          >
            {{ error }}
          </p>
        </div>

        <footer
          class="ctv:flex ctv:flex-col ctv:gap-2.5 @xl:flex-row @xl:flex-wrap @xl:items-center @xl:justify-end"
        >
          <ReuseDocsLink v-if="docsUrl && isWide" />

          <div
            class="ctv:flex ctv:max-w-full ctv:flex-col ctv:gap-2.5 @xl:flex-row @xl:flex-wrap @xl:justify-end"
          >
            <Button
              v-for="action in actions"
              :key="action"
              :variant="action === 'accept' ? 'inverted' : 'secondary'"
              size="lg"
              class="ctv:w-full @xl:w-auto"
              :loading="action === 'accept' && accepting"
              :disabled="accepting"
              @click="choose(action)"
            >
              {{
                action === 'accept'
                  ? $t('agent.consent.accept')
                  : $t('agent.consent.reject')
              }}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  </div>
</template>
