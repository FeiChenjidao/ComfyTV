<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'

import type { AugmentedResultItem } from '@agent/utils/resultItem'

const props = defineProps<{
  allGalleryItems: AugmentedResultItem[]
  activeIndex: number
}>()

const emit = defineEmits<{ 'update:activeIndex': [index: number] }>()

const hasMultiple = computed(() => props.allGalleryItems.length > 1)
const activeItem = computed(() => {
  const item = props.allGalleryItems[props.activeIndex]
  if (!item) return null
  return {
    ...item,
    isVideo: item.mediaType === 'video',
    isAudio: item.mediaType === 'audio',
  }
})

function close(): void {
  emit('update:activeIndex', -1)
}

function step(direction: number): void {
  const count = props.allGalleryItems.length
  if (!count) return
  emit('update:activeIndex', (props.activeIndex + direction + count) % count)
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
  else if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div
      class="agent-scope ctv:fixed ctv:inset-0 ctv:z-1700 ctv:flex ctv:items-center ctv:justify-center ctv:bg-black/80 ctv:p-8"
      role="dialog"
      aria-modal="true"
      @click.self="close"
    >
      <button
        type="button"
        class="ctv:absolute ctv:top-4 ctv:right-4 ctv:flex ctv:size-9 ctv:cursor-pointer ctv:items-center ctv:justify-center ctv:rounded-full ctv:bg-black/50 ctv:text-white ctv:hover:bg-black/70"
        aria-label="close"
        @click="close"
      >
        <i class="ctv:icon-[lucide--x] ctv:size-5" />
      </button>
      <button
        v-if="hasMultiple"
        type="button"
        class="ctv:absolute ctv:top-1/2 ctv:left-4 ctv:flex ctv:size-9 ctv:-translate-y-1/2 ctv:cursor-pointer ctv:items-center ctv:justify-center ctv:rounded-full ctv:bg-black/50 ctv:text-white ctv:hover:bg-black/70"
        @click="step(-1)"
      >
        <i class="ctv:icon-[lucide--chevron-left] ctv:size-5" />
      </button>
      <button
        v-if="hasMultiple"
        type="button"
        class="ctv:absolute ctv:top-1/2 ctv:right-4 ctv:flex ctv:size-9 ctv:-translate-y-1/2 ctv:cursor-pointer ctv:items-center ctv:justify-center ctv:rounded-full ctv:bg-black/50 ctv:text-white ctv:hover:bg-black/70"
        @click="step(1)"
      >
        <i class="ctv:icon-[lucide--chevron-right] ctv:size-5" />
      </button>
      <template v-if="activeItem">
        <video
          v-if="activeItem.isVideo"
          :src="activeItem.url"
          controls
          autoplay
          class="ctv:max-h-full ctv:max-w-full ctv:rounded-lg"
        />
        <audio v-else-if="activeItem.isAudio" :src="activeItem.url" controls autoplay />
        <img v-else :src="activeItem.url" :alt="activeItem.filename" class="ctv:max-h-full ctv:max-w-full ctv:rounded-lg ctv:object-contain" />
      </template>
    </div>
  </Teleport>
</template>
