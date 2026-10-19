<template>
  <div v-if="primaryNames.length || advancedNames.length" class="v2-tripo">
    <div v-for="name in primaryCombos" :key="name" class="v2-tripo__row v2-tripo__row--model">
      <span class="v2-tripo__label">{{ labelOf(name) }}</span>
      <ComfyTVSelect :model-value="sv(name)" :options="optionsOf(name)" :filterable="false" @update:model-value="v => writeVal(name, v)" />
    </div>
    <div v-if="primaryToggles.length" class="v2-tripo__row v2-tripo__row--toggles">
      <label v-for="name in primaryToggles" :key="name" class="v2-tripo__toggle">
        <input type="checkbox" :checked="boolVal(name)" @change="e => writeVal(name, (e.target as HTMLInputElement).checked)" />{{ labelOf(name) }}
      </label>
    </div>
    <div v-for="name in primaryNumbers" :key="name" class="v2-tripo__row v2-tripo__row--model">
      <span class="v2-tripo__label">{{ labelOf(name) }}</span>
      <input type="number" :value="sv(name)" :min="num(name, 'min')" :max="num(name, 'max')" :step="num(name, 'step') ?? 1" @change="e => writeVal(name, Number((e.target as HTMLInputElement).value))" />
    </div>
    <div v-for="name in primaryTexts" :key="name" class="v2-tripo__row v2-tripo__row--model">
      <span class="v2-tripo__label">{{ labelOf(name) }}</span>
      <textarea :value="sv(name)" @change="e => writeVal(name, (e.target as HTMLTextAreaElement).value)" />
    </div>
    <div v-if="advancedNames.length" class="v2-tripo__row v2-tripo__row--advanced">
      <ComfyTVPopover v-model:open="open" side="top" width="330px">
      <template #trigger><button type="button" class="v2-tripo__advanced" @pointerdown.stop>高级参数<svg viewBox="0 0 10 6" fill="none" :class="open && 'v2-tripo__chev--open'"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" /></svg></button></template>
      <div class="v2-tripo__pop" @pointerdown.stop>
        <div v-for="name in advancedNames" :key="name" class="v2-tripo__row">
          <span class="v2-tripo__label">{{ labelOf(name) }}</span>
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
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import { parseParamItems, serializeParamItems } from '@/composables/stages/useCustomParams'
import { useBoundOptionKeys } from '@/composables/stages/useBoundOptionKeys'
import { useBoundOptionMeta } from '@/composables/stages/useBoundOptionMeta'
import type { LGraphNode } from '@/lib/comfyApp'
import { OPTION_LABEL_KEYS, optionLabelKey } from '@/v2/optionLabels'
import { useWidgetValues } from '@/v2/useWidgetValues'

/** Soft display order only — unknown bound keys still appear (alpha). */
const ORDER = [
  'model_version', 'mode', 'material', 'geometry_file_format', 'texture_mode', 'polygon_count',
  'texture', 'pbr', 'should_remesh', 'should_texture', 'ultra_mode',
  'tier', 'polygon_count', 'creative', 'mesh_faces', 'mesh_mode', 'is_micro',
  'topology', 'target_polycount', 'symmetry_mode', 'pose_mode', 'texture_prompt', 'texture_resolution', 'output_mode', 'export_uv', 'compress_geometry', 'use_original_alpha', 'bbox_width', 'bbox_height', 'bbox_length', 'height_cm',
  'seed', 'negative', 'texture_quality', 'geometry_quality', 'face_limit', 'quad',
  'smart_low_poly', 'auto_size', 'orientation', 'texture_alignment',
  'tapose', 'hd_texture', 'texture_delight', 'addon_highpack',
]

const SKIP_WIDGETS = new Set([
  'force_run_token', 'project_id', 'parent_output_id', 'workflow',
  'main_prompt', 'custom_params', 'selected_index', 'pool', 'append_results',
  'v2_shell', 'comfytv_stage', 'captured_image', 'meta_json',
])

const props = withDefaults(defineProps<{
  getNode: () => LGraphNode | undefined
  workflowKind?: string | null
}>(), { workflowKind: 'model' })

const { t, te } = useI18n()
const open = ref(false)
const workflowKind = toRef(props, 'workflowKind')
const { keys: boundKeys } = useBoundOptionKeys(props.getNode, workflowKind)
const { metaByKey } = useBoundOptionMeta(props.getNode, workflowKind)

function trackedNames(): string[] {
  const names = new Set<string>(['custom_params', 'workflow', ...Object.keys(OPTION_LABEL_KEYS), ...ORDER])
  for (const w of (props.getNode()?.widgets ?? []) as Array<{ name?: string }>) {
    const n = String(w?.name ?? '')
    if (n && !n.startsWith('$$') && !SKIP_WIDGETS.has(n)) names.add(n)
  }
  return [...names]
}

const { values, widgetOf, write } = useWidgetValues(props.getNode, trackedNames())

const names = computed(() => {
  void values.custom_params
  void metaByKey.value
  return [...boundKeys.value].sort((a, b) => {
    const ia = ORDER.indexOf(a)
    const ib = ORDER.indexOf(b)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b)
  })
})

/** Partner-schema advanced flag only — no per-workflow hardcoding. */
function isAdvanced(name: string): boolean {
  return metaByKey.value.get(name)?.advanced === true
}

function parentValueMatches(when: string[], raw: unknown): boolean {
  const candidates = new Set<string>([String(raw ?? '')])
  if (raw === true || raw === 1) candidates.add('true')
  if (raw === false || raw === 0) candidates.add('false')
  const s = String(raw ?? '').toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') candidates.add('true')
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') candidates.add('false')
  return when.some(v => candidates.has(String(v)))
}

function rawOptionValue(name: string): unknown {
  const w = widgetOf(name)
  if (w) return values[name]
  const found = parseParamItems(String(values.custom_params ?? '{}')).find(it => it.key === name)
  if (found) return found.value
  return metaByKey.value.get(name)?.defaultValue
}

/**
 * DynamicCombo children only show for the active parent branch.
 * Uses child.dynamicWhen when present; otherwise parent.dynamicBranches.
 */
function isVisibleForParent(name: string): boolean {
  const meta = metaByKey.value.get(name)
  if (meta?.dynamicWhen?.length && meta.dynamicParent) {
    const parentMeta = metaByKey.value.get(meta.dynamicParent)
    const branches = parentMeta?.dynamicBranches
    // Sole branch (e.g. Tripo P2 model=P2 only) — always show children.
    if (branches && Object.keys(branches).length === 1) return true
    const raw = rawOptionValue(meta.dynamicParent)
    if (raw == null || raw === '') {
      return !!(branches && Object.keys(branches).length === 1)
    }
    return parentValueMatches(meta.dynamicWhen, raw)
  }
  for (const [parentKey, parentMeta] of metaByKey.value) {
    const branches = parentMeta.dynamicBranches
    if (!branches) continue
    const appears = Object.values(branches).some(ks => ks.includes(name))
    if (!appears) continue
    if (Object.keys(branches).length === 1) return true
    const active = String(rawOptionValue(parentKey) ?? '')
    return (branches[active] ?? []).includes(name)
  }
  return true
}

/** Partner-schema meta is required for custom_params-only knobs (correct type + branch). */
function isReady(name: string): boolean {
  if (widgetOf(name)) return true
  return metaByKey.value.has(name)
}

const primaryNames = computed(() => {
  void metaByKey.value
  for (const k of Object.keys(values)) void values[k]
  return names.value.filter(n => isReady(n) && !isAdvanced(n) && isVisibleForParent(n))
})
const advancedNames = computed(() => {
  void metaByKey.value
  for (const k of Object.keys(values)) void values[k]
  return names.value.filter(n => isReady(n) && isAdvanced(n) && isVisibleForParent(n))
})

/** Prefer partner-node meta (matches built-in node); Stage widget is fallback. */
function kind(name: string): 'combo' | 'number' | 'toggle' | 'text' {
  void metaByKey.value
  const meta = metaByKey.value.get(name)
  if (meta?.control === 'combo' || meta?.control === 'number' || meta?.control === 'toggle') {
    return meta.control
  }
  const w = widgetOf(name)
  if (w) {
    const t = String(w.type ?? '').toLowerCase()
    if (Array.isArray(w.options?.values) && w.options!.values!.length) return 'combo'
    if (t === 'combo') return 'combo'
    if (t === 'number' || t === 'slider' || t === 'int' || t === 'float') return 'number'
    if (t === 'boolean' || t === 'toggle' || typeof w.value === 'boolean') return 'toggle'
  }
  if (meta?.control === 'text') return 'text'
  return 'text'
}

const primaryCombos = computed(() => {
  void metaByKey.value
  return primaryNames.value.filter(n => kind(n) === 'combo')
})
const primaryToggles = computed(() => {
  void metaByKey.value
  return primaryNames.value.filter(n => kind(n) === 'toggle')
})
const primaryNumbers = computed(() => {
  void metaByKey.value
  return primaryNames.value.filter(n => kind(n) === 'number')
})
const primaryTexts = computed(() => {
  void metaByKey.value
  return primaryNames.value.filter(n => kind(n) === 'text')
})

const LABELS: Record<string, string> = {
  model_version: '模型', mode: '模式', material: '材质',
  geometry_file_format: '几何格式', texture_mode: '纹理模式', polygon_count: '面数预设',
  texture: '纹理', pbr: 'PBR', should_remesh: '重拓扑', should_texture: '纹理', ultra_mode: 'Ultra',
  seed: '种子', negative: '负面提示词', texture_quality: '纹理质量', geometry_quality: '几何质量',
  face_limit: '面数限制', quad: '四边面', smart_low_poly: '智能低模', auto_size: '自动尺寸',
  orientation: '方向', texture_alignment: '纹理对齐',
  tapose: 'T/A Pose', hd_texture: 'HD 纹理', texture_delight: '去除烘焙光照', addon_highpack: 'HighPack',
  tier: '档位', creative: '创意', mesh_faces: '面数', mesh_mode: '网格模式', is_micro: '微细节',
  topology: '拓扑', target_polycount: '目标面数',
  symmetry_mode: '对称', pose_mode: '姿态', texture_prompt: '纹理提示词',
  texture_resolution: '纹理分辨率', output_mode: '输出模式',
  export_uv: '导出 UV', compress_geometry: '压缩几何',
  use_original_alpha: '保留透明', bbox_width: '包围盒宽', bbox_height: '包围盒高',
  bbox_length: '包围盒长', height_cm: '身高(cm)',
}

function labelOf(name: string): string {
  if (LABELS[name]) return LABELS[name]
  const key = optionLabelKey(name)
  if (key && te(key)) return String(t(key))
  const metaLabel = metaByKey.value.get(name)?.label
  if (metaLabel && metaLabel !== name) return metaLabel
  return name.replace(/_/g, ' ')
}

function customItems() {
  return parseParamItems(String(values.custom_params ?? '{}'))
}

function readRaw(name: string): unknown {
  return rawOptionValue(name)
}

function sv(name: string): string {
  const v = readRaw(name)
  return v == null ? '' : String(v)
}

function optionsOf(name: string): string[] {
  void metaByKey.value
  const metaOpts = metaByKey.value.get(name)?.options
  if (metaOpts?.length) return metaOpts.map(String)
  const v = widgetOf(name)?.options?.values
  if (Array.isArray(v) && v.length) return v.map(String)
  return []
}

function num(name: string, key: 'min' | 'max' | 'step'): number | undefined {
  void metaByKey.value
  const meta = metaByKey.value.get(name)
  const fromMeta = meta?.[key]
  if (typeof fromMeta === 'number') return fromMeta
  const fromWidget = widgetOf(name)?.options?.[key]
  return typeof fromWidget === 'number' ? fromWidget : undefined
}

function boolVal(name: string): boolean {
  const v = readRaw(name)
  return v === true || v === 1 || v === 'true'
}

function writeVal(name: string, value: unknown) {
  if (widgetOf(name)) {
    write(name, value)
    return
  }
  const items = customItems()
  const idx = items.findIndex(it => it.key === name)
  const stored = value == null ? '' : value
  if (idx >= 0) items[idx] = { ...items[idx]!, value: stored }
  else items.push({ key: name, value: stored })
  write('custom_params', serializeParamItems(items))
}
</script>

<style scoped>
.v2-tripo { display:flex; flex-direction:column; align-items:stretch; gap:6px; min-width:0; width:100%; }
.v2-tripo__row { display:flex; align-items:center; gap:8px; min-width:0; }
.v2-tripo__row--model .v2-tripo__label { width:52px; flex:none; }
.v2-tripo__row--model :deep(button) { flex:1; }
.v2-tripo__row--model input[type=number],
.v2-tripo__row--model textarea { flex:1; }
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
