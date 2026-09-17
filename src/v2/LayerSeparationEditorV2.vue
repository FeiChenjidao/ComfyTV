<template>
  <div
    class="v2-ed"
    :class="{ 'v2-psd--drag': dragOver }"
    @pointerdown.stop @pointermove.stop @pointerup.stop
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="fileInput"
      type="file"
      accept=".psd,.psb,image/vnd.adobe.photoshop"
      class="v2-psd__file"
      @change="onFileChange"
    />

    <div class="v2-ed__canvas v2-psd__body">
      <div class="v2-psd__side">
        <div class="v2-psd__tree">
          <div v-if="!displayedRows.length" class="v2-ed__empty v2-psd__empty">
            {{ dragOver ? $t('psdLayerTree.dropHint') : $t('layerSeparation.emptyHint') }}
          </div>
          <button
            v-for="row in displayedRows"
            :key="row.id"
            type="button"
            class="v2-psd__row"
            :data-on="selectedSet.has(row.id) ? '1' : ''"
            :data-hidden="row.visible ? '' : '1'"
            :aria-selected="selectedSet.has(row.id)"
            :style="{ paddingLeft: `${8 + row.depth * 12 + (row.clip ? 12 : 0)}px` }"
            :title="rowTitle(row)"
            @click="selectRow(row.id, $event)"
          >
            <span class="v2-psd__chev" @click.stop="row.hasChildren && toggleCollapsed(row.id)">
              <i
                v-if="row.hasChildren"
                :class="['pi', collapsed.has(row.id) ? 'pi-chevron-right' : 'pi-chevron-down']"
              />
            </span>
            <i v-if="row.clip" class="pi pi-caret-up v2-psd__clip" />
            <span class="v2-psd__name">{{ row.name }}</span>
            <i v-if="row.warning" class="pi pi-exclamation-triangle v2-psd__warn" />
          </button>
        </div>
        <button type="button" class="v2-psd__expand" @click="expandImages">
          {{ $t('psdLayerTree.expand') }}
        </button>
      </div>
      <div class="v2-ed__fit v2-psd__preview">
        <img v-if="previewUrl" :src="previewUrl" draggable="false" @dragstart.prevent />
        <div v-else class="v2-ed__empty">{{ $t('layerSeparation.previewHint') }}</div>
      </div>
    </div>

    <div class="v2-ed__panel">
      <div class="v2-ed__chips">
        <button type="button" class="v2-ed__chip" @click="fileInput?.click()">
          {{ fileName || $t('layerSeparation.loadPsd') }}
        </button>
      </div>
    </div>

    <div class="v2-ed__status">
      <span
        v-if="outWidth && outHeight && (outWidth !== width || outHeight !== height)"
        class="v2-ed__dims"
      >{{ $t('psdLayerTree.scaled', { w: outWidth, h: outHeight, dw: width, dh: height }) }}</span>
      <span v-else-if="width && height" class="v2-ed__dims">{{ $t('psdLayerTree.dims', { w: width, h: height }) }}</span>
      <span class="v2-ed__spacer" />
      <span v-if="error">{{ error }}</span>
      <span v-else-if="loading" class="v2-ed__busy">{{ $t('psdLayerTree.loading') }}</span>
      <span v-else-if="compositing" class="v2-ed__busy">{{ $t('psdLayerTree.compositing') }}</span>
      <span v-else-if="previewUrl" class="v2-ed__ok">{{ $t('psdLayerTree.done') }}</span>
      <span v-else-if="displayedRows.length">{{ $t('psdLayerTree.clickHint') }}</span>
      <span v-else>{{ $t('layerSeparation.emptyHint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { spawnOrFocusImagesSplit } from '@/composables/stages/spawnFollowUp'
import { useLayerSeparation } from '@/composables/stages/useLayerSeparation'
import { t } from '@/i18n'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  node: LGraphNode
  state: StageState
}>()

const {
  fileName, width, height, outWidth, outHeight,
  displayedRows, selectedSet,
  loading, compositing, error, previewUrl,
  collapsed, toggleCollapsed, selectRow, pickFiles,
} = useLayerSeparation(props.node, props.state)

function rowTitle(row: { clip: boolean; warning: boolean }) {
  const parts: string[] = []
  if (row.clip) parts.push(t('psdLayerTree.clipping'))
  if (row.warning) parts.push(t('psdLayerTree.warning'))
  return parts.join(' — ') || undefined
}

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
let dragCount = 0

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  pickFiles(Array.from(input.files ?? []))
  input.value = ''
}

function onDragEnter() {
  dragCount++
  dragOver.value = true
}

function onDragLeave() {
  dragCount = Math.max(0, dragCount - 1)
  if (dragCount === 0) dragOver.value = false
}

function onDrop(e: DragEvent) {
  dragCount = 0
  dragOver.value = false
  pickFiles(Array.from(e.dataTransfer?.files ?? []))
}

function expandImages() {
  spawnOrFocusImagesSplit(props.node)
}
</script>

<style scoped>
.v2-ed {
  height: 100%;
  overflow: hidden;
}
.v2-psd__file { display: none; }
.v2-psd__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  flex-direction: row;
}
.v2-psd__side {
  flex: 0 0 42%;
  min-width: 120px;
  max-width: 240px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--v2-slab-border);
  background: var(--v2-slab-bg);
}
.v2-psd__tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  user-select: none;
}
.v2-psd__expand {
  flex: none;
  margin: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--v2-slab-border);
  background: var(--v2-chip-bg, transparent);
  color: var(--v2-text-mid);
  font: 500 11px/1.3 system-ui, sans-serif;
  cursor: pointer;
}
.v2-psd__expand:hover { background: var(--v2-hover-bg); color: var(--v2-text-strong); }
.v2-psd__empty { position: relative; inset: auto; padding: 16px 10px; }
.v2-psd__row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--v2-text-mid);
  font: 500 11px/1.4 system-ui, sans-serif;
  cursor: pointer;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 8px;
  text-align: left;
}
.v2-psd__row:hover { background: var(--v2-hover-bg); color: var(--v2-text-strong); }
.v2-psd__row[data-on='1'] {
  background: color-mix(in srgb, var(--v2-accent) 28%, transparent);
  color: var(--v2-accent-text);
  box-shadow: inset 3px 0 0 var(--v2-accent);
}
.v2-psd__row[data-on='1']:hover {
  background: color-mix(in srgb, var(--v2-accent) 38%, transparent);
}
.v2-psd__row[data-hidden='1'] { opacity: 0.45; }
.v2-psd__chev {
  width: 14px;
  flex: none;
  display: inline-flex;
  justify-content: center;
  font-size: 9px;
}
.v2-psd__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.v2-psd__clip { font-size: 9px; opacity: 0.8; flex: none; }
.v2-psd__warn { font-size: 9px; color: #fbbf24; flex: none; }
.v2-psd__preview { position: relative; flex: 1; min-width: 0; }
.v2-psd--drag {
  outline: 2px dashed rgba(167, 139, 250, 0.75);
  outline-offset: -2px;
}
</style>
