<template>
  <ComfyTVPopover v-model:open="open" side="top" width="300px">
    <template #trigger>
      <button type="button" class="v2-gptopt__chip" :aria-expanded="open" @pointerdown.stop>
        <span>{{ size }}</span><span class="v2-gptopt__muted">{{ quality }}</span>
        <svg viewBox="0 0 10 6" fill="none" :class="['v2-gptopt__chev', open && 'v2-gptopt__chev--open']"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
    </template>
    <div class="v2-gptopt__pop" @pointerdown.stop>
      <div class="v2-gptopt__title">尺寸</div>
      <ComfyTVSelect :model-value="size" :options="SIZE_OPTIONS" :filterable="false" @update:model-value="v => setValue('size', v)" />
      <div class="v2-gptopt__sliders" :data-disabled="size !== 'Custom' ? '1' : ''">
        <label><span>自定义宽度</span><div class="v2-gptopt__value"><input type="range" :value="width" min="408" max="3840" step="16" :disabled="size !== 'Custom'" @input="e => setValue('custom_width', Number((e.target as HTMLInputElement).value))" /><input class="v2-gptopt__number" type="number" :value="width" min="408" max="3840" step="16" :disabled="size !== 'Custom'" @change="e => setValue('custom_width', Number((e.target as HTMLInputElement).value))" /></div></label>
        <label><span>自定义高度</span><div class="v2-gptopt__value"><input type="range" :value="height" min="408" max="3840" step="16" :disabled="size !== 'Custom'" @input="e => setValue('custom_height', Number((e.target as HTMLInputElement).value))" /><input class="v2-gptopt__number" type="number" :value="height" min="408" max="3840" step="16" :disabled="size !== 'Custom'" @change="e => setValue('custom_height', Number((e.target as HTMLInputElement).value))" /></div></label>
      </div>
      <div class="v2-gptopt__title">背景</div>
      <ComfyTVSelect :model-value="background" :options="BACKGROUND_OPTIONS" :filterable="false" @update:model-value="v => setValue('background', v)" />
      <div class="v2-gptopt__title">质量</div>
      <ComfyTVSelect :model-value="quality" :options="QUALITY_OPTIONS" :filterable="false" @update:model-value="v => setValue('quality', v)" />
    </div>
  </ComfyTVPopover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import { parseParamItems, serializeParamItems } from '@/composables/stages/useCustomParams'
import type { LGraphNode } from '@/lib/comfyApp'
import { useWidgetValues } from '@/v2/useWidgetValues'

const SIZE_OPTIONS = ['auto', '1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840', 'Custom']
const BACKGROUND_OPTIONS = ['auto', 'transparent', 'opaque']
const QUALITY_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max']
const props = defineProps<{ getNode: () => LGraphNode | undefined }>()
const open = ref(false)
const { values, write } = useWidgetValues(props.getNode, ['custom_params'])

function items() { return parseParamItems(String(values.custom_params ?? '{}')) }
function read(key: string, fallback: string | number): string | number {
  const found = items().find(item => item.key === key || item.key.split('.').pop() === key)
  return found?.value == null ? fallback : found.value as string | number
}
const size = computed(() => String(read('size', 'auto')))
const background = computed(() => String(read('background', 'auto')))
const quality = computed(() => String(read('quality', 'auto')))
const width = computed(() => Number(read('custom_width', 1024)) || 1024)
const height = computed(() => Number(read('custom_height', 1024)) || 1024)

function setValue(key: string, value: string | number) {
  if (key === 'custom_width' || key === 'custom_height') {
    const numeric = Number(value)
    value = Math.min(3840, Math.max(408, Number.isFinite(numeric) ? numeric : 1024))
  }
  const current = items()
  const old = current.find(item => item.key === key || item.key.split('.').pop() === key)
  const storedKey = old?.key ?? key
  const next = old
    ? current.map(item => item.key === storedKey ? { ...item, value } : item)
    : [...current, { key: storedKey, value }]
  write('custom_params', serializeParamItems(next))
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
.v2-gptopt__sliders label { display:grid; gap:5px; }
.v2-gptopt__sliders span { display:flex; justify-content:space-between; }
.v2-gptopt__value { display:flex; align-items:center; gap:8px; }
.v2-gptopt__value input[type="range"] { flex:1; min-width:0; accent-color:var(--v2-accent-text); }
.v2-gptopt__number { width:64px; height:24px; padding:0 5px; border:1px solid var(--v2-chip-border); border-radius:6px; background:transparent; color:var(--v2-text-strong); font:500 11px/1 system-ui,sans-serif; }
.v2-gptopt__number:focus { outline:none; border-color:var(--v2-accent-border); }
</style>
