<template>
  <div class="v2-ed" @pointerdown.stop @pointermove.stop @pointerup.stop>
    <div ref="containerEl" class="v2-ed__canvas">
      <div class="v2-ed__fit">
        <img
          v-if="sourceImageUrl"
          ref="imgEl"
          :src="sourceImageUrl"
          draggable="false"
          @load="onImgLoad"
          @dragstart.prevent
        />
      </div>
      <div v-if="sourceImageUrl && displayed" class="v2-csplit__overlay"
           :style="{ '--csplit-line': SPLIT_LINE_PX + 'px' }">
        <button
          v-for="(cell, i) in overlayCells"
          :key="`c${cell.index}`"
          type="button"
          class="v2-csplit__cell"
          :class="{ 'v2-csplit__cell--edit': annotating }"
          :style="cellStyle(cell)"
          :disabled="!annotating"
          @pointerdown.stop="annotating && stampCell(i)"
        >
          <span v-if="cellLabels[i]" class="v2-csplit__tag">{{ cellLabels[i] }}</span>
        </button>
        <div
          v-for="(t, i) in vSplits"
          :key="`v${i}`"
          class="v2-csplit__band v2-csplit__band--v"
          :data-on="selected?.axis === 'v' && selected.index === i ? '1' : ''"
          :style="lineStyle('v', t)"
          @pointerdown.stop="onLineDown($event, 'v', i)"
          @pointermove="onLineMove"
          @pointerup="onLineUp"
        />
        <div
          v-for="(t, i) in hSplits"
          :key="`h${i}`"
          class="v2-csplit__band v2-csplit__band--h"
          :data-on="selected?.axis === 'h' && selected.index === i ? '1' : ''"
          :style="lineStyle('h', t)"
          @pointerdown.stop="onLineDown($event, 'h', i)"
          @pointermove="onLineMove"
          @pointerup="onLineUp"
        />
      </div>
      <div v-if="!sourceImageUrl" class="v2-ed__empty">{{ $t('customSplit.connectImage') }}</div>
    </div>

    <div class="v2-ed__panel">
      <div class="v2-ed__chips">
        <button type="button" class="v2-ed__chip" :disabled="!canAddV" @click="addV">
          {{ $t('customSplit.addV') }}
        </button>
        <button type="button" class="v2-ed__chip" :disabled="!canAddH" @click="addH">
          {{ $t('customSplit.addH') }}
        </button>
        <button type="button" class="v2-ed__chip" :disabled="!selected" @click="removeSelected">
          {{ $t('customSplit.remove') }}
        </button>
        <button type="button" class="v2-ed__chip" :data-on="annotating ? '1' : ''" @click="toggleAnnotating">
          {{ $t('customSplit.annotate') }}
        </button>
        <button
          type="button"
          class="v2-ed__chip"
          :disabled="!sourceImageUrl || splitting || generatingModel"
          @click="onGenerateModel"
        >
          {{ $t('customSplit.generateModel') }}
        </button>
      </div>
      <div v-if="annotating" class="v2-ed__chips">
        <button
          v-for="face in FACE_LABELS"
          :key="face"
          type="button"
          class="v2-ed__chip"
          :data-on="selectedFace === face ? '1' : ''"
          @click="selectedFace = face"
        >
          {{ face }}
        </button>
      </div>
    </div>

    <div class="v2-ed__status">
      <span class="v2-ed__dims">{{ cellCount }}</span>
      <span class="v2-ed__spacer" />
      <span v-if="!sourceImageUrl">{{ $t('customSplit.connectImage') }}</span>
      <span v-else-if="splitting" class="v2-ed__busy">{{ $t('customSplit.splitting', { n: cellCount }) }}</span>
      <span v-else-if="annotating">{{ $t('customSplit.annotateHint') }}</span>
      <span v-else-if="state.output" class="v2-ed__ok">{{ $t('customSplit.done', { n: cellCount }) }}</span>
      <span v-else>{{ $t('customSplit.hint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'

import {
  cellsFromSplits,
  cellOverlayStyle,
  displayedImageRect,
  FACE_LABELS,
  imageScreenRect,
  splitBandStyle,
  SPLIT_HIT_PX,
  SPLIT_LINE_PX,
  useCustomSplit,
  type SplitAxis,
} from '@/composables/stages/useCustomSplit'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  node: LGraphNode
  state: StageState
}>()

const {
  sourceImageUrl, vSplits, hSplits,
  selected,
  addV, addH, removeSelected,
  beginLineDrag, moveLineDrag, endLineDrag,
  canAddV, canAddH, cellCount, splitting,
  cellLabels, annotating, selectedFace,
  toggleAnnotating, stampCell,
  generateMultiViewModel,
} = useCustomSplit(props.node, props.state)

const generatingModel = ref(false)
async function onGenerateModel() {
  if (generatingModel.value) return
  generatingModel.value = true
  try { await generateMultiViewModel() }
  finally { generatingModel.value = false }
}

const containerEl = ref<HTMLDivElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const natW = ref(0)
const natH = ref(0)
const { width: contW, height: contH } = useElementSize(containerEl)

function onImgLoad() {
  if (!imgEl.value) return
  natW.value = imgEl.value.naturalWidth
  natH.value = imgEl.value.naturalHeight
}

const displayed = computed(() =>
  displayedImageRect(natW.value, natH.value, contW.value, contH.value))

const overlayCells = computed(() => {
  if (natW.value <= 0 || natH.value <= 0) return []
  return cellsFromSplits(vSplits.value, hSplits.value, natW.value, natH.value)
})

function lineStyle(axis: SplitAxis, t: number) {
  return splitBandStyle(axis, displayed.value!, t, SPLIT_HIT_PX)
}

function cellStyle(cell: (typeof overlayCells.value)[number]) {
  return cellOverlayStyle(cell, displayed.value!, natW.value, natH.value)
}

let dragging: { axis: SplitAxis; index: number } | null = null

function onLineDown(e: PointerEvent, axis: SplitAxis, index: number) {
  e.preventDefault()
  const image = imageScreenRect(imgEl.value, containerEl.value, displayed.value)
  if (!image) return
  beginLineDrag(axis, index, e.clientX, e.clientY, image)
  dragging = { axis, index }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onLineMove(e: PointerEvent) {
  if (!dragging) return
  moveLineDrag(e.clientX, e.clientY)
}

function onLineUp(e: PointerEvent) {
  dragging = null
  endLineDrag()
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
}
</script>

<style scoped>
.v2-csplit__overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.v2-csplit__band {
  position: absolute;
  pointer-events: auto;
  background: transparent;
}
.v2-csplit__band::after {
  content: '';
  position: absolute;
  background: color-mix(in srgb, var(--v2-accent) 85%, white);
  box-shadow: 0 0 1px rgba(0, 0, 0, 0.8);
}
.v2-csplit__band[data-on='1']::after {
  background: var(--v2-accent);
}
.v2-csplit__band--v { cursor: col-resize; }
.v2-csplit__band--h { cursor: row-resize; }
.v2-csplit__band--v::after {
  top: 0;
  bottom: 0;
  left: 50%;
  width: var(--csplit-line, 2px);
  transform: translateX(-50%);
}
.v2-csplit__band--h::after {
  left: 0;
  right: 0;
  top: 50%;
  height: var(--csplit-line, 2px);
  transform: translateY(-50%);
}
.v2-csplit__cell {
  position: absolute;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 5px;
  border: 0;
  background: transparent;
  pointer-events: none;
  appearance: none;
}
.v2-csplit__cell--edit {
  pointer-events: auto;
  cursor: pointer;
  background: color-mix(in srgb, var(--v2-accent) 10%, transparent);
}
.v2-csplit__cell--edit:hover {
  background: color-mix(in srgb, var(--v2-accent) 22%, transparent);
}
.v2-csplit__tag {
  font: 600 11px/1 system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 5px;
  color: #fff;
  background: rgb(0 0 0 / 0.62);
  pointer-events: none;
}
</style>
