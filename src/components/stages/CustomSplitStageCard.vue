<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-full ctv:grow"
       @pointerdown.stop @pointermove.stop @pointerup.stop>
    <div ref="containerEl"
         class="ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-[280px] ctv:rounded-md ctv:overflow-hidden ctv:border ctv:border-border-subtle
                ctv:bg-black">
      <div class="ctv:absolute ctv:inset-0 ctv:flex ctv:items-center ctv:justify-center">
      <div v-if="!sourceImageUrl"
           class="ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:text-white/50">
        <i class="pi pi-pause ctv:text-[32px] ctv:opacity-60" />
        <div class="ctv:text-xs">{{ $t('customSplit.connectImage') }}</div>
      </div>
      <template v-else>
        <img
          ref="imgEl"
          :src="sourceImageUrl"
          class="ctv:max-w-full ctv:max-h-full ctv:object-contain ctv:select-none ctv:pointer-events-none"
          draggable="false"
          @load="onImgLoad"
          @dragstart.prevent
        />
        <div v-if="displayed" class="ctv:absolute ctv:inset-0 ctv:pointer-events-none"
             :style="{ '--csplit-line': SPLIT_LINE_PX + 'px' }">
          <button
            v-for="(cell, i) in overlayCells"
            :key="`c${cell.index}`"
            type="button"
            class="csplit-cell"
            :class="{ 'csplit-cell--edit': annotating }"
            :style="cellStyle(cell)"
            :disabled="!annotating"
            @pointerdown.stop="annotating && stampCell(i)"
          >
            <span v-if="cellLabels[i]" class="csplit-cell__tag">{{ cellLabels[i] }}</span>
          </button>
          <div
            v-for="(t, i) in vSplits"
            :key="`v${i}`"
            class="csplit-band csplit-band--v"
            :data-on="selected?.axis === 'v' && selected.index === i ? '1' : ''"
            :style="lineStyle('v', t)"
            @pointerdown.stop="onLineDown($event, 'v', i)"
            @pointermove="onLineMove"
            @pointerup="onLineUp"
          />
          <div
            v-for="(t, i) in hSplits"
            :key="`h${i}`"
            class="csplit-band csplit-band--h"
            :data-on="selected?.axis === 'h' && selected.index === i ? '1' : ''"
            :style="lineStyle('h', t)"
            @pointerdown.stop="onLineDown($event, 'h', i)"
            @pointermove="onLineMove"
            @pointerup="onLineUp"
          />
        </div>
      </template>
      </div>
    </div>

    <div class="ctv:text-2xs ctv:text-center ctv:py-0.5">
      <span v-if="!sourceImageUrl" class="ctv:text-muted-foreground">{{ $t('customSplit.connectImage') }}</span>
      <span v-else-if="splitting" class="ctv:text-muted-foreground">{{ $t('customSplit.splitting', { n: cellCount }) }}</span>
      <span v-else-if="annotating" class="ctv:text-muted-foreground">{{ $t('customSplit.annotateHint') }}</span>
      <span v-else-if="state.output" class="ctv:text-success-background">{{ $t('customSplit.done', { n: cellCount }) }}</span>
      <span v-else class="ctv:text-muted-foreground">{{ $t('customSplit.hint') }}</span>
    </div>

    <div class="ctv:flex ctv:gap-1">
      <button type="button" :class="btnClass" :disabled="!canAddV" @click="addV">
        {{ $t('customSplit.addV') }}
      </button>
      <button type="button" :class="btnClass" :disabled="!canAddH" @click="addH">
        {{ $t('customSplit.addH') }}
      </button>
      <button type="button" :class="btnClass" :disabled="!selected" @click="removeSelected">
        {{ $t('customSplit.remove') }}
      </button>
      <button type="button" :class="btnClass" :data-on="annotating ? '1' : ''" @click="toggleAnnotating">
        {{ $t('customSplit.annotate') }}
      </button>
      <button
        type="button"
        :class="btnClass"
        :disabled="!sourceImageUrl || splitting || generatingModel"
        @click="onGenerateModel"
      >
        {{ $t('customSplit.generateModel') }}
      </button>
    </div>
    <div v-if="annotating" class="ctv:flex ctv:gap-1">
      <button
        v-for="face in FACE_LABELS"
        :key="face"
        type="button"
        :class="btnClass"
        :data-on="selectedFace === face ? '1' : ''"
        @click="selectedFace = face"
      >
        {{ face }}
      </button>
    </div>

    <StageCard
      :state="state"
      :node="node"
      :on-run-request="onRunRequest"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
      hide-context
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'

import StageCard from '@/components/stages/StageCard.vue'
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
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
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

const btnClass = [
  'ctv:flex-1 ctv:py-1 ctv:px-1.5 ctv:rounded ctv:text-xs ctv:cursor-pointer ctv:border',
  'ctv:bg-secondary-background ctv:border-border-subtle ctv:text-base-foreground',
  'ctv:hover:bg-secondary-background-hover',
  'ctv:disabled:opacity-40 ctv:disabled:cursor-not-allowed',
  'ctv:data-[on=1]:border-primary-color ctv:data-[on=1]:bg-primary-color/15',
].join(' ')
</script>

<style scoped>
.csplit-band {
  position: absolute;
  pointer-events: auto;
  background: transparent;
}
.csplit-band::after {
  content: '';
  position: absolute;
  background: rgb(255 255 255 / 0.85);
  box-shadow: 0 0 1px rgb(0 0 0 / 0.8);
}
.csplit-band[data-on='1']::after {
  background: var(--p-primary-color, #60a5fa);
}
.csplit-band--v { cursor: col-resize; }
.csplit-band--h { cursor: row-resize; }
.csplit-band--v::after {
  top: 0;
  bottom: 0;
  left: 50%;
  width: var(--csplit-line, 2px);
  transform: translateX(-50%);
}
.csplit-band--h::after {
  left: 0;
  right: 0;
  top: 50%;
  height: var(--csplit-line, 2px);
  transform: translateY(-50%);
}
.csplit-cell {
  position: absolute;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 4px;
  border: 0;
  background: transparent;
  pointer-events: none;
  appearance: none;
}
.csplit-cell--edit {
  pointer-events: auto;
  cursor: pointer;
  background: rgb(0 0 0 / 0.08);
}
.csplit-cell--edit:hover {
  background: rgb(96 165 250 / 0.18);
}
.csplit-cell__tag {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  color: #fff;
  background: rgb(0 0 0 / 0.65);
  pointer-events: none;
}
</style>
