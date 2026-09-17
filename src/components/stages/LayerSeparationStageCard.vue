<template>
  <div
    class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-full ctv:grow"
    :class="dragOver && 'ctv:rounded ctv:outline ctv:outline-2 ctv:-outline-offset-2 ctv:outline-primary-background/70'"
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
      class="ctv:hidden"
      @change="onFileChange"
    />

    <div class="ctv:flex ctv:items-center ctv:gap-1">
      <button type="button" :class="btnClass" class="ctv:flex-1" @click="fileInput?.click()">
        <i class="pi pi-folder-open" />
        <span class="ctv:truncate">{{ fileName || $t('layerSeparation.loadPsd') }}</span>
      </button>
      <button type="button" :class="btnClass" class="ctv:w-auto ctv:px-2" @click="expandImages">
        <i class="pi pi-sitemap" />
      </button>
    </div>

    <div class="ls-body">
      <div
        class="psd-tree ctv:min-h-[120px] ctv:max-h-[180px] ctv:overflow-y-auto ctv:rounded-md
               ctv:border ctv:border-border-subtle ctv:bg-secondary-background"
      >
        <div
          v-if="!displayedRows.length"
          class="ctv:flex ctv:h-full ctv:min-h-[120px] ctv:items-center ctv:justify-center
                 ctv:text-2xs ctv:text-muted-foreground ctv:px-2 ctv:text-center"
        >
          {{ dragOver ? $t('psdLayerTree.dropHint') : $t('layerSeparation.emptyHint') }}
        </div>
        <button
          v-for="row in displayedRows"
          :key="row.id"
          type="button"
          class="psd-row"
          :data-on="selectedSet.has(row.id) ? '1' : ''"
          :data-hidden="row.visible ? '' : '1'"
          :aria-selected="selectedSet.has(row.id)"
          :style="{ paddingLeft: `${6 + row.depth * 12 + (row.clip ? 12 : 0)}px` }"
          :title="rowTitle(row)"
          @click="selectRow(row.id, $event)"
        >
          <span
            class="psd-row__chev"
            @click.stop="row.hasChildren && toggleCollapsed(row.id)"
          >
            <i
              v-if="row.hasChildren"
              :class="['pi', collapsed.has(row.id) ? 'pi-chevron-right' : 'pi-chevron-down']"
            />
          </span>
          <i v-if="row.clip" class="pi pi-caret-up psd-row__clip" />
          <i :class="['pi', rowIcon(row.kind), 'psd-row__icon']" />
          <span class="psd-row__name">{{ row.name }}</span>
          <i v-if="row.warning" class="pi pi-exclamation-triangle psd-row__warn" />
        </button>
      </div>

      <div class="ls-preview ctv:rounded-md ctv:border ctv:border-border-subtle ctv:overflow-hidden">
        <ThumbImg
          v-if="previewUrl"
          :src="previewUrl"
          :thumb-max="THUMB_PREVIEW"
          class="ctv:size-full ctv:object-contain"
          draggable="false"
          @dragstart.prevent
        />
        <div
          v-else
          class="ctv:flex ctv:size-full ctv:items-center ctv:justify-center
                 ctv:text-2xs ctv:text-muted-foreground ctv:px-2 ctv:text-center"
        >
          {{ $t('layerSeparation.previewHint') }}
        </div>
      </div>
    </div>

    <div class="ctv:text-2xs ctv:text-center ctv:py-0.5">
      <span v-if="error" class="ctv:text-destructive-background">{{ error }}</span>
      <span v-else-if="loading" class="ctv:text-muted-foreground">{{ $t('psdLayerTree.loading') }}</span>
      <span v-else-if="compositing" class="ctv:text-muted-foreground">{{ $t('psdLayerTree.compositing') }}</span>
      <span v-else-if="previewUrl" class="ctv:text-success-background">{{ $t('psdLayerTree.done') }}</span>
      <span v-else-if="displayedRows.length" class="ctv:text-muted-foreground">{{ $t('psdLayerTree.clickHint') }}</span>
      <span v-else class="ctv:text-muted-foreground">{{ $t('layerSeparation.emptyHint') }}</span>
      <span
        v-if="outWidth && outHeight && (outWidth !== width || outHeight !== height)"
        class="ctv:text-muted-foreground"
      >
        · {{ $t('psdLayerTree.scaled', { w: outWidth, h: outHeight, dw: width, dh: height }) }}
      </span>
      <span v-else-if="width && height" class="ctv:text-muted-foreground">
        · {{ $t('psdLayerTree.dims', { w: width, h: height }) }}
      </span>
    </div>

    <StageCard
      :state="state"
      :node="node"
      :on-run-request="onRunRequest"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
      hide-context
      hide-output
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import StageCard from '@/components/stages/StageCard.vue'
import ThumbImg from '@/components/widgets/ThumbImg.vue'
import { spawnOrFocusImagesSplit } from '@/composables/stages/spawnFollowUp'
import { useLayerSeparation } from '@/composables/stages/useLayerSeparation'
import { t } from '@/i18n'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { THUMB_PREVIEW } from '@/utils/thumbUrl'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const {
  fileName, width, height, outWidth, outHeight,
  displayedRows, selectedSet,
  loading, compositing, error, previewUrl,
  collapsed, toggleCollapsed, selectRow, pickFiles,
} = useLayerSeparation(props.node, props.state)

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
let dragCount = 0

function rowIcon(kind: string) {
  if (kind === 'document' || kind === 'group') return 'pi-folder'
  if (kind === 'text') return 'pi-align-left'
  return 'pi-stop'
}

function rowTitle(row: { clip: boolean; warning: boolean }) {
  const parts: string[] = []
  if (row.clip) parts.push(t('psdLayerTree.clipping'))
  if (row.warning) parts.push(t('psdLayerTree.warning'))
  return parts.join(' — ') || undefined
}

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

const btnClass = [
  'ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:py-1 ctv:px-1.5 ctv:rounded ctv:text-xs ctv:cursor-pointer ctv:border',
  'ctv:bg-secondary-background ctv:border-border-subtle ctv:text-base-foreground',
  'ctv:hover:bg-secondary-background-hover',
].join(' ')
</script>

<style scoped>
.ls-body {
  display: grid;
  grid-template-columns: minmax(120px, 42%) 1fr;
  gap: 6px;
  min-height: 140px;
}
.ls-preview {
  min-height: 120px;
  background-color: #1a1a1a;
  background-image:
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.psd-tree { user-select: none; }
.psd-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}
.psd-row:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.psd-row[data-on='1'] {
  background: color-mix(in srgb, var(--p-primary-color, #8b5cf6) 28%, transparent);
  box-shadow: inset 3px 0 0 var(--p-primary-color, #8b5cf6);
}
.psd-row[data-on='1']:hover {
  background: color-mix(in srgb, var(--p-primary-color, #8b5cf6) 38%, transparent);
}
.psd-row[data-hidden='1'] { opacity: 0.45; }
.psd-row__chev {
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex: none;
  align-items: center;
  justify-content: center;
  font-size: 9px;
}
.psd-row__icon { font-size: 10px; opacity: 0.7; flex: none; }
.psd-row__clip { font-size: 9px; opacity: 0.8; flex: none; }
.psd-row__name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.psd-row__warn { font-size: 9px; color: #fbbf24; flex: none; }
</style>
