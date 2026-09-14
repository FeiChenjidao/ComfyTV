<template>
  <div class="split-preview">
    <div v-if="!items.length" class="split-preview__empty">
      {{ connected ? $t('imagesSplit.empty') : $t('imagesSplit.connect') }}
    </div>
    <div v-else class="split-preview__list">
      <button
        v-for="(item, index) in items"
        :key="`${item.index}:${item.image_url}`"
        type="button"
        class="split-preview__item"
        :data-on="selectedSet.has(index) ? '1' : ''"
        :aria-selected="selectedSet.has(index)"
        @click="onSelect(index, $event)"
      >
        <span class="split-preview__name" :title="item.label">{{ item.label }}</span>
        <div class="split-preview__thumb">
          <ThumbImg :src="item.image_url" :thumb-max="1024" />
        </div>
      </button>
    </div>
    <div v-if="items.length" class="split-preview__hint">
      {{ $t('imagesSplit.selectHint') }}
    </div>
    <div v-if="truncated" class="split-preview__hint">
      {{ $t('imagesSplit.truncated', { n: max }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import ThumbImg from '@/components/widgets/ThumbImg.vue'
import type { ImageGroupItem } from '@/composables/stages/imagesSplit'

defineProps<{
  items: ImageGroupItem[]
  truncated: boolean
  connected: boolean
  max: number
  selectedSet: Set<number>
}>()

const emit = defineEmits<{
  select: [index: number, event: MouseEvent]
}>()

function onSelect(index: number, e: MouseEvent) {
  emit('select', index, e)
}
</script>

<style scoped>
.split-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.split-preview__empty {
  display: flex;
  flex: 1;
  min-height: 120px;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 8px;
  font-size: 11px;
  color: var(--p-text-muted-color, #9ca3af);
}
.split-preview__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}
.split-preview__item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  appearance: none;
}
.split-preview__item[data-on='1'] .split-preview__name {
  color: var(--p-primary-color, #a78bfa);
}
.split-preview__item[data-on='1'] .split-preview__thumb {
  outline: 2px solid var(--p-primary-color, #a78bfa);
  outline-offset: -2px;
}
.split-preview__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}
.split-preview__thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 8px;
  background-color: #1a1a1a;
  background-image:
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.split-preview__thumb :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.split-preview__hint {
  font-size: 10px;
  text-align: center;
  color: var(--p-text-muted-color, #9ca3af);
}
</style>
