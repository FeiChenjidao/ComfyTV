<template>
  <Teleport to="body">
    <div
      v-if="isOpen && current"
      class="ctv:fixed ctv:inset-0 ctv:z-[9999] ctv:flex ctv:items-center ctv:justify-center ctv:cursor-zoom-out ctv:bg-black/90"
      role="dialog"
      @click.self="close"
      @wheel.prevent.stop
    >
      <div
        ref="container"
        class="ctv:inline-flex ctv:items-center ctv:justify-center ctv:touch-none ctv:select-none ctv:cursor-grab"
        @click.stop
      >
        <video
          v-if="kind === 'video'"
          :key="current.url"
          :src="current.url"
          class="ctv:block ctv:max-w-[80vw] ctv:max-h-[80vh] ctv:object-contain ctv:cursor-default
                 ctv:shadow-[0_8px_40px_rgb(0_0_0/0.6)]"
          controls
          autoplay
          playsinline
          @pointerdown.stop
        />
        <div
          v-else-if="kind === 'audio'"
          class="ctv:flex ctv:w-[min(560px,80vw)] ctv:flex-col ctv:items-center ctv:gap-5 ctv:rounded-xl ctv:bg-white/5 ctv:px-8 ctv:py-10
                 ctv:shadow-[0_8px_40px_rgb(0_0_0/0.6)]"
          @pointerdown.stop
        >
          <svg
            class="ctv:size-16 ctv:text-white/55"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          >
            <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 8v8" />
          </svg>
          <audio
            :key="current.url"
            :src="current.url"
            class="ctv:w-full"
            controls
            autoplay
            preload="metadata"
          />
        </div>
        <div
          v-else-if="kind === 'model'"
          class="ctv:h-[70vh] ctv:w-[min(70vw,70vh)] ctv:overflow-hidden ctv:rounded-xl ctv:bg-white/5
                 ctv:shadow-[0_8px_40px_rgb(0_0_0/0.6)]"
          @pointerdown.stop
          @wheel.stop
        >
          <ModelPreview :key="current.url" :src="current.url" />
        </div>
        <img
          v-else
          ref="img"
          :src="current.url"
          class="ctv:block ctv:max-w-[60vw] ctv:max-h-[60vh] ctv:object-contain ctv:cursor-[inherit]
                 ctv:shadow-[0_8px_40px_rgb(0_0_0/0.6)]"
          draggable="false"
          :alt="current.label || current.url"
        />
      </div>

      <button
        v-if="count > 1"
        type="button"
        class="ctv:absolute ctv:left-4 ctv:top-1/2 ctv:-translate-y-1/2 ctv:size-10 ctv:flex ctv:items-center ctv:justify-center
               ctv:rounded-full ctv:bg-black/55 ctv:text-white ctv:border ctv:border-white/30
               ctv:hover:bg-black/85 ctv:hover:border-white/55 ctv:cursor-pointer
               ctv:disabled:opacity-30 ctv:disabled:cursor-default ctv:disabled:hover:bg-black/55 ctv:disabled:hover:border-white/30"
        :disabled="!hasPrev"
        :title="$t('stage.action.prev')"
        @click.stop="prev"
      ><i class="pi pi-chevron-left" /></button>

      <button
        v-if="count > 1"
        type="button"
        class="ctv:absolute ctv:right-4 ctv:top-1/2 ctv:-translate-y-1/2 ctv:size-10 ctv:flex ctv:items-center ctv:justify-center
               ctv:rounded-full ctv:bg-black/55 ctv:text-white ctv:border ctv:border-white/30
               ctv:hover:bg-black/85 ctv:hover:border-white/55 ctv:cursor-pointer
               ctv:disabled:opacity-30 ctv:disabled:cursor-default ctv:disabled:hover:bg-black/55 ctv:disabled:hover:border-white/30"
        :disabled="!hasNext"
        :title="$t('stage.action.next')"
        @click.stop="next"
      ><i class="pi pi-chevron-right" /></button>

      <div
        v-if="count > 1 || current.label"
        class="ctv:absolute ctv:bottom-4 ctv:left-1/2 ctv:-translate-x-1/2 ctv:flex ctv:items-center ctv:gap-2 ctv:max-w-[70vw]
               ctv:py-1 ctv:px-3 ctv:rounded-full ctv:text-xs ctv:leading-none
               ctv:bg-black/55 ctv:text-white ctv:border ctv:border-white/20"
      >
        <span v-if="count > 1" class="ctv:tabular-nums ctv:shrink-0">{{ index + 1 }} / {{ count }}</span>
        <span v-if="current.label" class="ctv:truncate">{{ current.label }}</span>
      </div>

      <button
        type="button"
        class="ctv:absolute ctv:top-4 ctv:right-4 ctv:size-9 ctv:flex ctv:items-center ctv:justify-center ctv:text-sm ctv:leading-none
               ctv:rounded-full ctv:cursor-pointer
               ctv:bg-black/55 ctv:text-white ctv:border ctv:border-white/30
               ctv:hover:bg-black/85 ctv:hover:border-white/55"
        :title="$t('stage.action.close')"
        @click.stop="close"
      ><i class="pi pi-times" /></button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useImagePanZoom } from '@/composables/widgets/useImagePanZoom'
import { lightboxKind, useLightbox } from '@/composables/useLightbox'
import ModelPreview from '@/components/stages/ModelPreview.vue'

const { isOpen, current, count, index, hasPrev, hasNext, close, prev, next } =
  useLightbox()
const kind = computed(() => (current.value ? lightboxKind(current.value) : 'image'))

const container = ref<HTMLElement | null>(null)
const img = ref<HTMLImageElement | null>(null)

useImagePanZoom(container, img, {
  resetKey: current,
  minZoom: 0.2,
  maxZoom: 8,
})

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
