<template>
  <ComfyTVPopover v-model:open="open" side="top" width="220px">
    <template #trigger>
      <button type="button" class="v2-ignisopt__chip" :aria-expanded="open" @pointerdown.stop>
        <span>{{ t('v2.ignisBackground.title') }}</span>
        <span class="v2-ignisopt__value">{{ optionLabel(background) }}</span>
        <svg viewBox="0 0 10 6" fill="none" :class="['v2-ignisopt__chev', open && 'v2-ignisopt__chev--open']">
          <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </template>

    <div class="v2-ignisopt__pop" @pointerdown.stop>
      <div class="v2-ignisopt__title">{{ t('v2.ignisBackground.title') }}</div>
      <button
        v-for="option in OPTIONS"
        :key="option"
        type="button"
        :class="['v2-ignisopt__option', option === background && 'v2-ignisopt__option--on']"
        @click="setBackground(option)"
      >
        <span>{{ optionLabel(option) }}</span>
        <i v-if="option === background" class="pi pi-check" />
      </button>
    </div>
  </ComfyTVPopover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import { parseParamItems, serializeParamItems } from '@/composables/stages/useCustomParams'
import type { LGraphNode } from '@/lib/comfyApp'
import { useWidgetValues } from '@/v2/useWidgetValues'

const OPTIONS = ['auto', 'transparent', 'opaque'] as const
type BackgroundOption = typeof OPTIONS[number]

const props = defineProps<{ getNode: () => LGraphNode | undefined }>()
const { t } = useI18n()
const open = ref(false)
const { values, write } = useWidgetValues(props.getNode, ['custom_params'])

const background = computed<BackgroundOption>(() => {
  const item = parseParamItems(String(values.custom_params ?? '{}'))
    .find(entry => entry.key === 'background' || entry.key.split('.').pop() === 'background')
  const value = String(item?.value ?? 'auto')
  return OPTIONS.includes(value as BackgroundOption) ? value as BackgroundOption : 'auto'
})

function optionLabel(option: BackgroundOption): string {
  return String(t(`v2.ignisBackground.${option}`))
}

function setBackground(value: BackgroundOption) {
  const current = parseParamItems(String(values.custom_params ?? '{}'))
  const index = current.findIndex(entry => entry.key === 'background' || entry.key.split('.').pop() === 'background')
  if (index >= 0) current[index] = { ...current[index]!, value }
  else current.push({ key: 'background', value })
  write('custom_params', serializeParamItems(current))
  open.value = false
}
</script>

<style scoped>
.v2-ignisopt__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--v2-chip-border);
  border-radius: 8px;
  background: transparent;
  color: var(--v2-text-strong);
  font: 500 11px/1 system-ui, sans-serif;
  cursor: pointer;
}
.v2-ignisopt__chip:hover { background: var(--v2-hover-bg); }
.v2-ignisopt__value { color: var(--v2-text-muted); }
.v2-ignisopt__chev { width: 8px; height: 5px; flex: none; transition: transform .15s ease; }
.v2-ignisopt__chev--open { transform: rotate(180deg); }
.v2-ignisopt__pop {
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--v2-slab-border, #2c2c34);
  border-radius: 8px;
  background: var(--v2-slab-bg, #1c1c22);
  color: var(--v2-text-mid);
}
.v2-ignisopt__title { padding: 4px 6px 6px; color: var(--v2-text-muted); font: 500 10px/1 system-ui, sans-serif; }
.v2-ignisopt__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--v2-text-mid);
  font: 500 11px/1 system-ui, sans-serif;
  cursor: pointer;
}
.v2-ignisopt__option:hover { background: var(--v2-hover-bg); color: var(--v2-text-strong); }
.v2-ignisopt__option--on { color: var(--v2-accent-text); }
.v2-ignisopt__option i { font-size: 11px; }
</style>
