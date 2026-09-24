<template>
  <div v-if="rows.length" class="v2-params" @pointerdown.stop>
    <button type="button" class="v2-params__toggle" @click.stop="open = !open">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           :style="{ transform: open ? 'rotate(90deg)' : '' }">
        <path d="M9 5l7 7-7 7" />
      </svg>
      <span>{{ t('v2.params') }}</span>
      <span class="v2-params__count">{{ rows.length }}</span>
    </button>
    <div v-if="open" class="v2-params__grid">
      <label v-for="row in rows" :key="row.name" class="v2-params__row" :data-wide="row.type === 'textarea' ? '1' : ''">
        <span class="v2-params__label">{{ row.label }}</span>
        <div v-if="row.type === 'combo'" class="v2-params__select">
          <ComfyTVSelect
            :model-value="String(valueOf(row.name) ?? '')"
            :options="row.options!"
            :filterable="row.options!.length > 12"
            @update:model-value="(v) => write(row, v)"
          />
        </div>
        <input
          v-else-if="row.type === 'number'"
          type="number"
          class="v2-params__input"
          :value="valueOf(row.name)"
          :min="row.min"
          :max="row.max"
          :step="row.step"
          @change="(e) => write(row, (e.target as HTMLInputElement).value)"
        />
        <button
          v-else-if="row.type === 'boolean'"
          type="button"
          class="v2-params__bool"
          :data-on="valueOf(row.name) ? '1' : ''"
          @click.stop="write(row, !valueOf(row.name))"
        ><span /></button>
        <textarea
          v-else-if="row.type === 'textarea'"
          class="v2-params__input v2-params__textarea"
          :value="String(valueOf(row.name) ?? '')"
          rows="2"
          @change="(e) => write(row, (e.target as HTMLTextAreaElement).value)"
          @wheel.stop
        />
        <input
          v-else
          type="text"
          class="v2-params__input"
          :value="String(valueOf(row.name) ?? '')"
          @change="(e) => write(row, (e.target as HTMLInputElement).value)"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useBoundOptionKeys } from '@/composables/stages/useBoundOptionKeys'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import type { LGraphNode } from '@/lib/comfyApp'
import { OPTION_LABEL_KEYS, optionLabelKey } from '@/v2/optionLabels'
import { useWidgetValues } from '@/v2/useWidgetValues'

const { t, te } = useI18n()

const props = withDefaults(defineProps<{
  getNode: () => LGraphNode | undefined
  exclude?: string[]
  /** When true, hide widgets until the workflow binds option:<name>. */
  boundOnly?: boolean
  workflowKind?: string | null
}>(), {
  boundOnly: true,
  workflowKind: null,
})

const ALWAYS_SKIP = new Set([
  'force_run_token', 'project_id', 'parent_output_id', 'workflow',
  'main_prompt', 'custom_params', 'selected_index', 'pool',
  'v2_shell', 'comfytv_stage', '$$node-text-preview',
  'captured_image', 'meta_json',
])

interface Row {
  name: string
  label: string
  type: 'combo' | 'number' | 'boolean' | 'text' | 'textarea'
  options?: string[]
  min?: number
  max?: number
  step?: number
}

function widgetsOf(): any[] {
  return (props.getNode()?.widgets ?? []) as any[]
}

const TRACKED = [...Object.keys(OPTION_LABEL_KEYS), 'workflow']

const { widgetOf, write: writeRaw } = useWidgetValues(props.getNode, TRACKED)

const { keys: boundKeys } = useBoundOptionKeys(
  props.getNode,
  toRef(props, 'workflowKind'),
)

function labelOf(name: string): string {
  const key = optionLabelKey(name)
  if (key && te(key)) return String(t(key))
  return name
}

function valueOf(name: string): unknown {
  void comboOptionsVersion.value
  return widgetOf(name)?.value
}

const rows = computed<Row[]>(() => {
  void comboOptionsVersion.value
  void boundKeys.value
  const skip = new Set([...ALWAYS_SKIP, ...(props.exclude ?? [])])
  const out: Row[] = []
  for (const w of widgetsOf()) {
    const name = String(w?.name ?? '')
    if (!name || skip.has(name) || name.startsWith('$$')) continue
    if (props.boundOnly && !boundKeys.value.has(name)) continue
    const type = String(w?.type ?? '')
    if (type === 'button' || type === 'v2' || type === 'stage' || type === 'project') continue
    const label = labelOf(name)
    if (type === 'combo') {
      const vals = Array.isArray(w?.options?.values) ? w.options.values.map(String) : []
      out.push({ name, label, type: 'combo', options: vals })
    } else if (type === 'number' || type === 'slider' || type === 'int' || type === 'float') {
      out.push({
        name, label, type: 'number',
        min: w?.options?.min, max: w?.options?.max, step: w?.options?.step2 ?? w?.options?.step,
      })
    } else if (type === 'toggle' || type === 'boolean') {
      out.push({ name, label, type: 'boolean' })
    } else if (type === 'customtext') {
      out.push({ name, label, type: 'textarea' })
    } else if (type === 'text' || type === 'string') {
      out.push({ name, label, type: 'text' })
    }
  }
  return out
})

const open = ref(false)

function write(row: Row, raw: unknown) {
  if (row.type === 'number') {
    const n = Number(raw)
    writeRaw(row.name, Number.isFinite(n) ? n : 0)
  } else if (row.type === 'boolean') {
    writeRaw(row.name, Boolean(raw))
  } else {
    writeRaw(row.name, raw == null ? '' : String(raw))
  }
  comboOptionsVersion.value++
}
</script>

<style scoped>
.v2-params {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.v2-params__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  border: none;
  padding: 4px 8px;
  border-radius: 8px;
  background: transparent;
  color: var(--v2-text-muted);
  font: 500 11px/1 system-ui, sans-serif;
  cursor: pointer;
}
.v2-params__toggle:hover { background: var(--v2-hover-bg); color: var(--v2-text-mid); }
.v2-params__toggle svg { width: 11px; height: 11px; transition: transform 0.15s ease; }
.v2-params__count {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--v2-hover-bg);
  font-size: 10px;
}
.v2-params__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}
.v2-params__row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.v2-params__row[data-wide='1'] { grid-column: 1 / -1; }
.v2-params__label {
  color: var(--v2-text-faint);
  font: 500 10px/1 system-ui, sans-serif;
  text-transform: none;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v2-params__input {
  border: 1px solid var(--v2-chip-border);
  border-radius: 8px;
  background: transparent;
  color: var(--v2-text-strong);
  font: 500 11px/1.4 system-ui, sans-serif;
  padding: 5px 8px;
  outline: none;
  min-width: 0;
}
.v2-params__input:focus { border-color: var(--v2-accent-border); }
.v2-params__textarea { resize: vertical; min-height: 40px; }
.v2-params__select :deep(button) {
  height: 26px;
  padding: 0 8px;
  font-size: 11px;
  border-radius: 8px;
  border-width: 1px;
  background: transparent;
  border-color: var(--v2-chip-border);
}
.v2-params__bool {
  width: 34px;
  height: 20px;
  border: none;
  border-radius: 999px;
  background: var(--v2-hover-bg);
  cursor: pointer;
  position: relative;
  transition: background 0.15s ease;
}
.v2-params__bool span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--v2-text-mid);
  transition: transform 0.15s ease, background 0.15s ease;
}
.v2-params__bool[data-on='1'] { background: color-mix(in srgb, var(--v2-accent) 55%, transparent); }
.v2-params__bool[data-on='1'] span { transform: translateX(14px); background: #fff; }
</style>
