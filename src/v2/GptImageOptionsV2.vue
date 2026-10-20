<template>
  <ComfyTVPopover v-model:open="open" side="top" width="300px">
    <template #trigger>
      <button type="button" class="v2-gptopt__chip" :aria-expanded="open" @pointerdown.stop>
        <span>{{ size }}</span>
        <span class="v2-gptopt__muted">{{ quality }}</span>
        <span class="v2-gptopt__muted">{{ t('v2.batchCount', { n: batch }) }}</span>
        <svg viewBox="0 0 10 6" fill="none" :class="['v2-gptopt__chev', open && 'v2-gptopt__chev--open']"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
    </template>
    <div class="v2-gptopt__pop" @pointerdown.stop>
      <div class="v2-gptopt__title">尺寸</div>
      <ComfyTVSelect :model-value="size" :options="SIZE_OPTIONS" :filterable="false" @update:model-value="v => setValue('size', v)" />
      <div class="v2-gptopt__sliders" :data-disabled="size !== 'Custom' ? '1' : ''">
        <div class="v2-gptopt__dim-head">
          <span>自定义宽高</span>
          <button
            type="button"
            class="v2-gptopt__lock"
            :data-on="lockRatio ? '1' : ''"
            :disabled="size !== 'Custom'"
            :title="lockRatio ? t('imageCrop.unlockRatio') : t('imageCrop.lockRatio')"
            @click="toggleLock"
          >
            <i :class="['pi', lockRatio ? 'pi-lock' : 'pi-lock-open']" />
          </button>
        </div>
        <label>
          <span>宽度</span>
          <div class="v2-gptopt__value">
            <input type="range" :value="width" min="408" max="3840" step="16" :disabled="size !== 'Custom'" @input="e => setDim('width', Number((e.target as HTMLInputElement).value))" />
            <input
              class="v2-gptopt__number"
              type="number"
              :value="widthDraft ?? width"
              min="408"
              max="3840"
              step="1"
              :disabled="size !== 'Custom'"
              @focus="widthDraft = String(width)"
              @input="e => { widthDraft = (e.target as HTMLInputElement).value }"
              @keydown.enter.prevent="commitDraft('width')"
              @blur="commitDraft('width')"
            />
          </div>
        </label>
        <label>
          <span>高度</span>
          <div class="v2-gptopt__value">
            <input type="range" :value="height" min="408" max="3840" step="16" :disabled="size !== 'Custom'" @input="e => setDim('height', Number((e.target as HTMLInputElement).value))" />
            <input
              class="v2-gptopt__number"
              type="number"
              :value="heightDraft ?? height"
              min="408"
              max="3840"
              step="1"
              :disabled="size !== 'Custom'"
              @focus="heightDraft = String(height)"
              @input="e => { heightDraft = (e.target as HTMLInputElement).value }"
              @keydown.enter.prevent="commitDraft('height')"
              @blur="commitDraft('height')"
            />
          </div>
        </label>
      </div>
      <div class="v2-gptopt__title">背景</div>
      <ComfyTVSelect :model-value="background" :options="BACKGROUND_OPTIONS" :filterable="false" @update:model-value="v => setValue('background', v)" />
      <div class="v2-gptopt__title">质量</div>
      <ComfyTVSelect :model-value="quality" :options="QUALITY_OPTIONS" :filterable="false" @update:model-value="v => setValue('quality', v)" />
      <div class="v2-gptopt__title">{{ t('v2.genopt.count') }}</div>
      <div class="v2-gptopt__row">
        <button
          v-for="n in BATCH_OPTIONS"
          :key="n"
          type="button"
          :class="['v2-gptopt__opt', n === batch && 'v2-gptopt__opt--on']"
          @click="setBatch(n)"
        >{{ t('v2.batchCount', { n }) }}</button>
      </div>
    </div>
  </ComfyTVPopover>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import { parseParamItems, serializeParamItems } from '@/composables/stages/useCustomParams'
import type { LGraphNode } from '@/lib/comfyApp'
import { useWidgetValues } from '@/v2/useWidgetValues'

const SIZE_OPTIONS = ['auto', '1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840', 'Custom']
const BACKGROUND_OPTIONS = ['auto', 'transparent', 'opaque']
const QUALITY_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max']
const BATCH_OPTIONS = Array.from({ length: 8 }, (_, i) => String(i + 1))
const DIM_MIN = 408
const DIM_MAX = 3840
const DIM_STEP = 16

const props = defineProps<{ getNode: () => LGraphNode | undefined }>()
const { t } = useI18n()
const open = ref(false)
const lockRatio = ref(true)
/** Frozen w/h captured when lock turns on — not recomputed while dragging. */
const lockedRatio = ref(1)
const widthDraft = ref<string | null>(null)
const heightDraft = ref<string | null>(null)
const { values, write } = useWidgetValues(props.getNode, ['custom_params', 'batch_size'])

function items() { return parseParamItems(String(values.custom_params ?? '{}')) }
function read(key: string, fallback: string | number): string | number {
  const found = items().find(item => item.key === key || item.key.split('.').pop() === key)
  return found?.value == null ? fallback : found.value as string | number
}
const size = computed(() => String(read('size', 'auto')))
const background = computed(() => String(read('background', 'auto')))
const quality = computed(() => String(read('quality', 'high')))
const width = computed(() => Number(read('custom_width', 1024)) || 1024)
const height = computed(() => Number(read('custom_height', 1024)) || 1024)
const batch = computed(() => {
  const n = Number(values.batch_size)
  return String(Number.isFinite(n) && n >= 1 ? Math.min(8, Math.round(n)) : 1)
})

function snapDim(value: number): number {
  const raw = Number.isFinite(value) ? value : 1024
  return Math.round(raw / DIM_STEP) * DIM_STEP
}

function clampDim(value: number): number {
  return Math.min(DIM_MAX, Math.max(DIM_MIN, snapDim(value)))
}

function clampIn(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, snapDim(value)))
}

/** Driver limits so the paired side stays inside [DIM_MIN, DIM_MAX] at frozen ratio. */
function widthLimits(ratio: number) {
  return {
    min: clampDim(Math.max(DIM_MIN, DIM_MIN * ratio)),
    max: clampDim(Math.min(DIM_MAX, DIM_MAX * ratio)),
  }
}
function heightLimits(ratio: number) {
  return {
    min: clampDim(Math.max(DIM_MIN, DIM_MIN / ratio)),
    max: clampDim(Math.min(DIM_MAX, DIM_MAX / ratio)),
  }
}

function captureRatio() {
  lockedRatio.value = width.value / Math.max(1, height.value)
}

function toggleLock() {
  lockRatio.value = !lockRatio.value
  if (lockRatio.value) captureRatio()
}

onMounted(() => {
  if (lockRatio.value) captureRatio()
})

function writeParams(next: ReturnType<typeof items>) {
  write('custom_params', serializeParamItems(next))
}

function upsert(current: ReturnType<typeof items>, key: string, value: string | number) {
  const old = current.find(item => item.key === key || item.key.split('.').pop() === key)
  const storedKey = old?.key ?? key
  if (old) return current.map(item => item.key === storedKey ? { ...item, value } : item)
  return [...current, { key: storedKey, value }]
}

function setValue(key: string, value: string | number) {
  if (key === 'custom_width' || key === 'custom_height') value = clampDim(Number(value))
  writeParams(upsert(items(), key, value))
}

function commitDraft(which: 'width' | 'height') {
  const draft = which === 'width' ? widthDraft : heightDraft
  const raw = draft.value
  draft.value = null
  if (raw == null || raw.trim() === '') return
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  setDim(which, n)
}

function setDim(which: 'width' | 'height', raw: number) {
  const ratio = lockedRatio.value > 0 ? lockedRatio.value : 1
  let nextW: number
  let nextH: number
  if (lockRatio.value && ratio > 0) {
    // Sliders stay on the full 408–3840 track so W/H look different.
    // Follow the dragged side; pair tracks frozen ratio. Only clamp the
    // driver at the edge where the pair would leave the legal box.
    if (which === 'width') {
      const lim = widthLimits(ratio)
      nextW = clampIn(raw, lim.min, lim.max)
      nextH = clampDim(nextW / ratio)
    } else {
      const lim = heightLimits(ratio)
      nextH = clampIn(raw, lim.min, lim.max)
      nextW = clampDim(nextH * ratio)
    }
  } else if (which === 'width') {
    nextW = clampDim(raw)
    nextH = height.value
  } else {
    nextW = width.value
    nextH = clampDim(raw)
  }
  widthDraft.value = null
  heightDraft.value = null
  let current = items()
  current = upsert(current, 'custom_width', nextW)
  current = upsert(current, 'custom_height', nextH)
  writeParams(current)
}

function setBatch(n: string) {
  write('batch_size', Number(n))
}
</script>

<style scoped>
.v2-gptopt__chip { display:flex; align-items:center; gap:6px; height:26px; padding:0 8px; border:1px solid var(--v2-chip-border); border-radius:8px; background:transparent; color:var(--v2-text-strong); font:500 11px/1 system-ui,sans-serif; cursor:pointer; }
.v2-gptopt__muted { color:var(--v2-text-muted); }
.v2-gptopt__chev { width:8px; height:5px; transition:transform .15s ease; }
.v2-gptopt__chev--open { transform:rotate(180deg); }
.v2-gptopt__pop { padding:12px; border:1px solid var(--v2-slab-border,#2c2c34); border-radius:8px; background:var(--v2-slab-bg,#1c1c22); color:var(--v2-text-mid); font:500 11px/1.2 system-ui,sans-serif; }
.v2-gptopt__title { margin:8px 0 6px; color:var(--v2-text-muted); }
.v2-gptopt__title:first-child { margin-top:0; }
.v2-gptopt__sliders { display:grid; gap:9px; margin-top:10px; }
.v2-gptopt__sliders[data-disabled="1"] { opacity:.45; }
.v2-gptopt__dim-head { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--v2-text-muted); }
.v2-gptopt__lock {
  display:inline-flex; align-items:center; justify-content:center;
  width:24px; height:22px; border:1px solid var(--v2-chip-border); border-radius:6px;
  background:transparent; color:var(--v2-text-mid); cursor:pointer;
}
.v2-gptopt__lock[data-on="1"] { border-color:var(--v2-accent-border); color:var(--v2-accent-text); background:color-mix(in srgb, var(--v2-accent-text) 12%, transparent); }
.v2-gptopt__lock:disabled { opacity:.45; cursor:default; }
.v2-gptopt__sliders label { display:grid; gap:5px; }
.v2-gptopt__sliders span { display:flex; justify-content:space-between; }
.v2-gptopt__value { display:flex; align-items:center; gap:8px; }
.v2-gptopt__value input[type="range"] { flex:1; min-width:0; accent-color:var(--v2-accent-text); }
.v2-gptopt__number { width:64px; height:24px; padding:0 5px; border:1px solid var(--v2-chip-border); border-radius:6px; background:transparent; color:var(--v2-text-strong); font:500 11px/1 system-ui,sans-serif; }
.v2-gptopt__number:focus { outline:none; border-color:var(--v2-accent-border); }
.v2-gptopt__row { display:flex; flex-wrap:wrap; gap:6px; }
.v2-gptopt__opt {
  min-width:34px; height:26px; padding:0 8px; border:1px solid var(--v2-chip-border); border-radius:6px;
  background:transparent; color:var(--v2-text-mid); font:500 11px/1 system-ui,sans-serif; cursor:pointer;
}
.v2-gptopt__opt--on { border-color:var(--v2-accent-border); color:var(--v2-accent-text); background:color-mix(in srgb, var(--v2-accent-text) 12%, transparent); }
</style>
