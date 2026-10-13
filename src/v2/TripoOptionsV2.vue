<template>
  <div class="v2-tripo">
    <div v-if="has('model_version')" class="v2-tripo__row v2-tripo__row--model">
      <span class="v2-tripo__label">模型</span>
      <ComfyTVSelect :model-value="sv('model_version')" :options="optionsOf('model_version')" :filterable="false" @update:model-value="v => writeVal('model_version', v)" />
    </div>
    <div class="v2-tripo__row v2-tripo__row--toggles">
      <label v-if="has('texture')" class="v2-tripo__toggle"><input type="checkbox" :checked="boolVal('texture')" @change="e => writeVal('texture', (e.target as HTMLInputElement).checked)" />纹理</label>
      <label v-if="has('pbr')" class="v2-tripo__toggle"><input type="checkbox" :checked="boolVal('pbr')" @change="e => writeVal('pbr', (e.target as HTMLInputElement).checked)" />PBR</label>
    </div>
    <div class="v2-tripo__row v2-tripo__row--advanced">
      <ComfyTVPopover v-model:open="open" side="top" width="330px">
      <template #trigger><button type="button" class="v2-tripo__advanced" @pointerdown.stop>高级参数<svg viewBox="0 0 10 6" fill="none" :class="open && 'v2-tripo__chev--open'"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" /></svg></button></template>
      <div class="v2-tripo__pop" @pointerdown.stop>
        <div v-for="name in ADVANCED" :key="name" class="v2-tripo__row">
          <span class="v2-tripo__label">{{ LABELS[name] ?? name }}</span>
          <ComfyTVSelect v-if="kind(name) === 'combo'" :model-value="sv(name)" :options="optionsOf(name)" :filterable="false" @update:model-value="v => writeVal(name, v)" />
          <input v-else-if="kind(name) === 'number'" type="number" :value="sv(name)" :min="num(name, 'min')" :max="num(name, 'max')" :step="num(name, 'step') ?? 1" @change="e => writeVal(name, Number((e.target as HTMLInputElement).value))" />
          <label v-else-if="kind(name) === 'toggle'" class="v2-tripo__check"><input type="checkbox" :checked="boolVal(name)" @change="e => writeVal(name, (e.target as HTMLInputElement).checked)" /></label>
          <textarea v-else :value="sv(name)" @change="e => writeVal(name, (e.target as HTMLTextAreaElement).value)" />
        </div>
      </div>
      </ComfyTVPopover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import type { LGraphNode } from '@/lib/comfyApp'
import { useWidgetValues } from '@/v2/useWidgetValues'

const ADVANCED = ['seed', 'negative', 'texture_quality', 'geometry_quality', 'face_limit', 'quad', 'smart_low_poly', 'auto_size', 'orientation', 'texture_alignment', 'material', 'mode', 'polygon_count', 'geometry_file_format', 'texture_mode', 'tapose', 'hd_texture', 'texture_delight', 'addon_highpack']
const LABELS: Record<string, string> = { seed: '种子', negative: '负面提示词', texture_quality: '纹理质量', geometry_quality: '几何质量', face_limit: '面数限制', quad: '四边面', smart_low_poly: '智能低模', auto_size: '自动尺寸', orientation: '方向', texture_alignment: '纹理对齐', material: '材质', mode: '模式', polygon_count: '面数预设', geometry_file_format: '几何格式', texture_mode: '纹理模式', tapose: 'T/A Pose', hd_texture: 'HD 纹理', texture_delight: '去除烘焙光照', addon_highpack: 'HighPack' }
const props = defineProps<{ getNode: () => LGraphNode | undefined }>()
const open = ref(false)
const names = ['model_version', 'texture', 'pbr', ...ADVANCED]
const { values, widgetOf, write } = useWidgetValues(props.getNode, names)
function has(name: string) { return !!widgetOf(name) }
function sv(name: string) { const v = values[name]; return v == null ? '' : String(v) }
function kind(name: string): 'combo' | 'number' | 'toggle' | 'text' {
  const w = widgetOf(name)
  const t = String(w?.type ?? '').toLowerCase()
  if (Array.isArray(w?.options?.values)) return 'combo'
  if (t === 'number' || t === 'slider' || t === 'int' || t === 'float') return 'number'
  if (t === 'boolean' || typeof w?.value === 'boolean') return 'toggle'
  return 'text'
}
function optionsOf(name: string): string[] { const v = widgetOf(name)?.options?.values; return Array.isArray(v) ? v.map(String) : [] }
function num(name: string, key: string): number | undefined { const v = widgetOf(name)?.options?.[key]; return typeof v === 'number' ? v : undefined }
function boolVal(name: string): boolean { return values[name] === true || values[name] === 1 || values[name] === 'true' }
function writeVal(name: string, value: unknown) { write(name, value) }
</script>

<style scoped>
.v2-tripo { display:flex; flex-direction:column; align-items:stretch; gap:6px; min-width:0; width:100%; }
.v2-tripo__row { display:flex; align-items:center; gap:8px; min-width:0; }
.v2-tripo__row--model .v2-tripo__label { width:52px; }
.v2-tripo__row--model :deep(button) { flex:1; }
.v2-tripo__row--advanced { justify-content:flex-start; }
.v2-tripo__toggle { display:inline-flex; align-items:center; gap:4px; color:var(--v2-text-mid); font:500 11px/1 system-ui,sans-serif; white-space:nowrap; }
.v2-tripo__toggle input,.v2-tripo__check input { accent-color:var(--v2-accent-text); }
.v2-tripo__advanced { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 8px; border:1px solid var(--v2-chip-border); border-radius:8px; background:transparent; color:var(--v2-text-mid); font:500 11px/1 system-ui,sans-serif; cursor:pointer; }
.v2-tripo__advanced:hover { background:var(--v2-hover-bg); color:var(--v2-text-strong); }
.v2-tripo__advanced svg { width:8px; height:5px; transition:transform .15s ease; }
.v2-tripo__chev--open { transform:rotate(180deg); }
.v2-tripo__pop { display:grid; gap:8px; max-height:420px; overflow-y:auto; padding:12px; border:1px solid var(--v2-slab-border,#2c2c34); border-radius:8px; background:var(--v2-slab-bg,#1c1c22); color:var(--v2-text-mid); font:500 11px/1.2 system-ui,sans-serif; }
.v2-tripo__pop .v2-tripo__row { display:grid; grid-template-columns:108px minmax(0,1fr); align-items:center; gap:8px; }
.v2-tripo__label { color:var(--v2-text-muted); }
.v2-tripo__row textarea,.v2-tripo__row input[type=number] { width:100%; min-height:26px; box-sizing:border-box; padding:5px 7px; border:1px solid var(--v2-chip-border); border-radius:6px; background:transparent; color:var(--v2-text-strong); font:500 11px/1.2 system-ui,sans-serif; }
.v2-tripo__row textarea { min-height:52px; resize:vertical; }
.v2-tripo__check { display:flex; justify-content:flex-end; }
</style>
