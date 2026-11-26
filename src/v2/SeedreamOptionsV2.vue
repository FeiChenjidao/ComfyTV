<template>
  <ComfyTVPopover v-model:open="open" side="top" width="340px">
    <template #trigger>
      <button type="button" class="v2-sdopt__chip" :aria-expanded="open" @pointerdown.stop>
        <span>{{ modelLabel }}</span>
        <span class="v2-sdopt__muted">{{ sizePreset }}</span>
        <span class="v2-sdopt__muted">{{ t('v2.batchCount', { n: batch }) }}</span>
        <svg viewBox="0 0 10 6" fill="none" :class="['v2-sdopt__chev', open && 'v2-sdopt__chev--open']">
          <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </template>

    <div class="v2-sdopt__pop" @pointerdown.stop>
      <div class="v2-sdopt__title">{{ t('v2.seedream.model') }}</div>
      <ComfyTVSelect :model-value="model" :options="modelOptions" :filterable="false" @update:model-value="setModel" />

      <div class="v2-sdopt__title">{{ t('v2.seedream.sizePreset') }}</div>
      <ComfyTVSelect :model-value="sizePreset" :options="currentSpec.sizeOptions" @update:model-value="setSizePreset" />
      <ReferenceImageSizeButtonV2 :get-node="props.getNode" @size="useReferenceSize" />

      <div class="v2-sdopt__dims" :data-disabled="customSize ? '0' : '1'">
        <label>
          <span>{{ t('v2.seedream.width') }}</span>
          <input
            type="number"
            :value="width"
            :min="currentSpec.width.min"
            :max="currentSpec.width.max"
            :step="currentSpec.width.step"
            :disabled="!customSize"
            @change="e => setNumber('width', (e.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          <span>{{ t('v2.seedream.height') }}</span>
          <input
            type="number"
            :value="height"
            :min="currentSpec.height.min"
            :max="currentSpec.height.max"
            :step="currentSpec.height.step"
            :disabled="!customSize"
            @change="e => setNumber('height', (e.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <template v-if="currentSpec.backgroundOptions.length">
        <div class="v2-sdopt__title">{{ t('v2.seedream.background') }}</div>
        <ComfyTVSelect :model-value="background" :options="currentSpec.backgroundOptions" :filterable="false" @update:model-value="v => setParam('background', v)" />
      </template>

      <div class="v2-sdopt__title">{{ t('v2.seedream.seed') }}</div>
      <div class="v2-sdopt__seed">
        <input
          type="number"
          :value="seed"
          :min="currentSpec.seed.min"
          :max="currentSpec.seed.max"
          :step="currentSpec.seed.step"
          @change="e => setNumber('seed', (e.target as HTMLInputElement).value)"
        />
        <button type="button" :title="t('v2.seedream.randomSeed')" @click="randomizeSeed">
          <IconShuffle />
        </button>
      </div>

      <div class="v2-sdopt__title">{{ t('v2.genopt.count') }}</div>
      <div class="v2-sdopt__row">
        <button
          v-for="n in BATCH_OPTIONS"
          :key="n"
          type="button"
          :class="['v2-sdopt__opt', n === batch && 'v2-sdopt__opt--on']"
          @click="setBatch(n)"
        >{{ t('v2.batchCount', { n }) }}</button>
      </div>
    </div>
  </ComfyTVPopover>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import IconShuffle from '~icons/lucide/shuffle'

import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import { parseParamItems, serializeParamItems } from '@/composables/stages/useCustomParams'
import { app, type LGraphNode } from '@/lib/comfyApp'
import { parseSeedreamModels, type SeedreamModelSpec } from '@/v2/seedreamSchema'
import { useWidgetValues } from '@/v2/useWidgetValues'
import ReferenceImageSizeButtonV2 from '@/v2/ReferenceImageSizeButtonV2.vue'

const BATCH_OPTIONS = Array.from({ length: 8 }, (_, i) => String(i + 1))
const FALLBACK: SeedreamModelSpec = {
  key: 'seedream 5.5',
  sizeOptions: ['(1K) 1024x1024 (1:1)', '(1.5K) 1536x1536 (1:1)', '(2K) 2048x2048 (1:1)', 'Custom'],
  defaultSize: '(2K) 2048x2048 (1:1)',
  width: { default: 2048, min: 240, max: 8594, step: 2 },
  height: { default: 2048, min: 240, max: 8594, step: 2 },
  backgroundOptions: ['auto', 'opaque', 'transparent'],
  defaultBackground: 'auto',
  seed: { default: 42, min: 0, max: 2147483647, step: 1 },
}

const props = defineProps<{ getNode: () => LGraphNode | undefined }>()
const { t } = useI18n()
const open = ref(false)
const specs = ref<SeedreamModelSpec[]>([FALLBACK])
const { values, write } = useWidgetValues(props.getNode, ['custom_params', 'batch_size'])

function items() { return parseParamItems(String(values.custom_params ?? '{}')) }
function read(key: string, fallback: string | number): string | number {
  const found = items().find(item => item.key === key || item.key.split('.').pop() === key)
  return found?.value == null ? fallback : found.value as string | number
}

const model = computed(() => String(read('model', FALLBACK.key)))
const currentSpec = computed(() => specs.value.find(spec => spec.key === model.value) ?? specs.value[0] ?? FALLBACK)
const modelOptions = computed(() => specs.value.map(spec => spec.key))
const modelLabel = computed(() => model.value.replace(/^seedream[ -]?/i, 'Seedream '))
const sizePreset = computed(() => String(read('size_preset', currentSpec.value.defaultSize)))
const customSize = computed(() => sizePreset.value.toLowerCase() === 'custom')
const width = computed(() => finite(read('width', currentSpec.value.width.default), currentSpec.value.width.default))
const height = computed(() => finite(read('height', currentSpec.value.height.default), currentSpec.value.height.default))
const background = computed(() => String(read('background', currentSpec.value.defaultBackground)))
const seed = computed(() => finite(read('seed', currentSpec.value.seed.default), currentSpec.value.seed.default))
const batch = computed(() => {
  const value = finite(values.batch_size, 1)
  return String(Math.min(8, Math.max(1, Math.round(value))))
})

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function upsert(current: ReturnType<typeof items>, key: string, value: string | number) {
  const old = current.find(item => item.key === key || item.key.split('.').pop() === key)
  const storedKey = old?.key ?? key
  if (old) return current.map(item => item.key === storedKey ? { ...item, value } : item)
  return [...current, { key: storedKey, value }]
}

function writeParams(next: ReturnType<typeof items>) {
  write('custom_params', serializeParamItems(next))
}

function setParam(key: string, value: string | number) {
  writeParams(upsert(items(), key, value))
}

function setModel(value: string) {
  const spec = specs.value.find(item => item.key === value) ?? FALLBACK
  let next = upsert(items(), 'model', spec.key)
  next = upsert(next, 'size_preset', spec.defaultSize)
  next = upsert(next, 'width', spec.width.default)
  next = upsert(next, 'height', spec.height.default)
  if (spec.backgroundOptions.length) next = upsert(next, 'background', spec.defaultBackground)
  writeParams(next)
}

function setSizePreset(value: string) {
  let next = upsert(items(), 'size_preset', value)
  const match = value.match(/(\d+)x(\d+)/i)
  if (match) {
    next = upsert(next, 'width', Number(match[1]))
    next = upsert(next, 'height', Number(match[2]))
  }
  writeParams(next)
}

function setNumber(key: 'width' | 'height' | 'seed', raw: string) {
  const spec = key === 'seed' ? currentSpec.value.seed : currentSpec.value[key]
  const value = finite(raw, spec.default)
  const snapped = Math.round(value / spec.step) * spec.step
  setParam(key, Math.min(spec.max, Math.max(spec.min, snapped)))
}

function useReferenceSize(imageWidth: number, imageHeight: number) {
  let next = upsert(items(), 'size_preset', 'Custom')
  for (const [key, value] of [['width', imageWidth], ['height', imageHeight]] as const) {
    const spec = currentSpec.value[key]
    const snapped = Math.round(value / spec.step) * spec.step
    next = upsert(next, key, Math.min(spec.max, Math.max(spec.min, snapped)))
  }
  writeParams(next)
}

function randomizeSeed() {
  const spec = currentSpec.value.seed
  setParam('seed', Math.floor(Math.random() * (spec.max - spec.min + 1)) + spec.min)
}

function setBatch(value: string) {
  write('batch_size', Number(value))
}

onMounted(async () => {
  try {
    const response = await app.api.fetchApi('/object_info/ByteDanceSeedreamNodeV3')
    if (!response.ok) return
    const parsed = parseSeedreamModels(await response.json())
    if (parsed.length) specs.value = parsed
  } catch {
    // Keep the shipped fallback when the official API node is unavailable.
  }
})
</script>

<style scoped>
.v2-sdopt__chip { display:flex; align-items:center; gap:6px; height:26px; max-width:100%; padding:0 8px; border:1px solid var(--v2-chip-border); border-radius:8px; background:transparent; color:var(--v2-text-strong); font:500 11px/1 system-ui,sans-serif; cursor:pointer; }
.v2-sdopt__muted { color:var(--v2-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.v2-sdopt__chev { width:8px; height:5px; flex:none; transition:transform .15s ease; }
.v2-sdopt__chev--open { transform:rotate(180deg); }
.v2-sdopt__pop { padding:12px; border:1px solid var(--v2-slab-border,#2c2c34); border-radius:8px; background:var(--v2-slab-bg,#1c1c22); color:var(--v2-text-mid); font:500 11px/1.2 system-ui,sans-serif; }
.v2-sdopt__title { margin:10px 0 6px; color:var(--v2-text-muted); }
.v2-sdopt__title:first-child { margin-top:0; }
.v2-sdopt__dims { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.v2-sdopt__dims[data-disabled='1'] { opacity:.45; }
.v2-sdopt__dims label { display:grid; gap:4px; color:var(--v2-text-muted); }
.v2-sdopt__dims input, .v2-sdopt__seed input { width:100%; min-width:0; height:26px; padding:0 7px; border:1px solid var(--v2-chip-border); border-radius:7px; background:transparent; color:var(--v2-text-strong); font:500 11px/1 system-ui,sans-serif; box-sizing:border-box; }
.v2-sdopt__dims input:focus, .v2-sdopt__seed input:focus { outline:none; border-color:var(--v2-accent-border); }
.v2-sdopt__seed { display:grid; grid-template-columns:1fr 28px; gap:6px; }
.v2-sdopt__seed button { width:28px; height:26px; padding:0; border:1px solid var(--v2-chip-border); border-radius:7px; background:transparent; color:var(--v2-text-mid); cursor:pointer; }
.v2-sdopt__seed button svg { width:13px; height:13px; }
.v2-sdopt__row { display:flex; flex-wrap:wrap; gap:6px; }
.v2-sdopt__opt { min-width:34px; height:26px; padding:0 8px; border:1px solid var(--v2-chip-border); border-radius:6px; background:transparent; color:var(--v2-text-mid); font:500 11px/1 system-ui,sans-serif; cursor:pointer; }
.v2-sdopt__opt--on { border-color:var(--v2-accent-border); color:var(--v2-accent-text); background:color-mix(in srgb, var(--v2-accent-text) 12%, transparent); }
</style>
