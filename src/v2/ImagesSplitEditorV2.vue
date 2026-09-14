<template>
  <div class="v2-ed" @pointerdown.stop>
    <div class="v2-ed__canvas v2-split">
      <ImagesSplitPreview
        :items="items"
        :truncated="truncated"
        :connected="connected"
        :max="max"
        :selected-set="selectedSet"
        @select="selectItem"
      />
    </div>
    <div class="v2-ed__panel">
      <div class="v2-ed__chips">
        <button
          type="button"
          class="v2-ed__chip"
          :disabled="!canMerge"
          @click="mergeSelected"
        >
          {{ $t('imagesSplit.merge') }}
        </button>
        <button
          type="button"
          class="v2-ed__chip"
          :disabled="!canVariations"
          @click="spawnVariations"
        >
          {{ $t('imagesSplit.variations') }}
        </button>
      </div>
      <div v-if="actionError" class="v2-split__err">{{ actionError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ImagesSplitPreview from '@/components/stages/ImagesSplitPreview.vue'
import { useImagesSplit } from '@/composables/stages/useImagesSplit'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  node: LGraphNode
  state: StageState
}>()

const {
  items, truncated, connected, max,
  selectedSet, canMerge, canVariations, actionError,
  selectItem, mergeSelected, spawnVariations,
} = useImagesSplit(props.node, props.state)
</script>

<style scoped>
.v2-ed {
  height: 100%;
  overflow: hidden;
}
.v2-split {
  padding: 8px;
  overflow: hidden;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.v2-split :deep(.split-preview__empty),
.v2-split :deep(.split-preview__hint) {
  color: var(--v2-text-faint);
}
.v2-split :deep(.split-preview__name) {
  color: var(--v2-text-strong);
}
.v2-split :deep(.split-preview__item[data-on='1'] .split-preview__name) {
  color: var(--v2-accent-text);
}
.v2-split :deep(.split-preview__item[data-on='1'] .split-preview__thumb) {
  outline-color: var(--v2-accent);
}
.v2-ed__chip:disabled {
  opacity: 0.4;
  pointer-events: none;
}
.v2-split__err {
  font: 500 11px/1.3 system-ui, sans-serif;
  color: #f87171;
  text-align: center;
}
</style>
