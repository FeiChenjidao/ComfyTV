<template>
  <section
    v-if="hasWidget && (attached.length || dynamicRows.length)"
    class="ctv:flex ctv:flex-col ctv:gap-1"
  >
    <div class="ctv:flex ctv:items-center ctv:gap-2">
      <div :class="sectionLabel">{{ $t('stageParams.section') }}</div>
    </div>

    <div
      v-for="item in attached"
      :key="item.key"
      class="ctv:flex ctv:items-center ctv:gap-2"
    >
      <span class="ctv:shrink-0 ctv:w-20 ctv:truncate ctv:text-[11px] ctv:text-muted-foreground" :title="defLabel(item.key)">
        {{ defLabel(item.key) }}
      </span>
      <div class="ctv:flex-1 ctv:min-w-0">
        <ComfyTVToggle
          v-if="defType(item.key) === 'boolean'"
          :model-value="Boolean(item.value)"
          @update:model-value="setVal(item.key, $event)"
        />
        <ComfyTVSlider
          v-else-if="useSlider(item.key)"
          :model-value="numVal(item.value)"
          :min="cfgNum(item.key, 'min')!"
          :max="cfgNum(item.key, 'max')!"
          :step="cfgNum(item.key, 'step') ?? (defType(item.key) === 'int' ? 1 : 0.1)"
          :precision="defType(item.key) === 'int' ? 0 : undefined"
          @update:model-value="setVal(item.key, $event)"
        />
        <ComfyTVNumber
          v-else-if="defType(item.key) === 'int' || defType(item.key) === 'float'"
          :model-value="numVal(item.value)"
          :min="cfgNum(item.key, 'min')"
          :max="cfgNum(item.key, 'max')"
          :step="cfgNum(item.key, 'step') ?? (defType(item.key) === 'int' ? 1 : 0.1)"
          :precision="defType(item.key) === 'int' ? 0 : undefined"
          @update:model-value="setVal(item.key, $event)"
        />
        <ComfyTVSelect
          v-else-if="defType(item.key) === 'combo'"
          :model-value="item.value as string"
          :options="comboOptions(item.key)"
          @update:model-value="setVal(item.key, $event)"
        />
        <ComfyTVText
          v-else
          :model-value="item.value == null ? '' : String(item.value)"
          :multiline="Boolean(cfg(item.key)?.multiline)"
          :placeholder="cfgStr(item.key, 'placeholder')"
          @update:model-value="setVal(item.key, $event)"
        />
      </div>
    </div>

    <div
      v-for="row in dynamicRows"
      :key="'dyn:' + row.key"
      class="ctv:flex ctv:items-center ctv:gap-2"
    >
      <span class="ctv:shrink-0 ctv:w-20 ctv:truncate ctv:text-[11px] ctv:text-muted-foreground" :title="row.key">
        {{ row.label }}
      </span>
      <div class="ctv:flex-1 ctv:min-w-0">
        <ComfyTVToggle
          v-if="row.control === 'toggle'"
          :model-value="Boolean(row.value)"
          @update:model-value="setVal(row.key, $event)"
        />
        <ComfyTVNumber
          v-else-if="row.control === 'number'"
          :model-value="numVal(row.value)"
          :min="row.min"
          :max="row.max"
          :step="row.step ?? 1"
          @update:model-value="setVal(row.key, $event)"
        />
        <ComfyTVSelect
          v-else-if="row.control === 'combo'"
          :model-value="row.value == null ? '' : String(row.value)"
          :options="row.options ?? []"
          :filterable="(row.options?.length ?? 0) > 12"
          @update:model-value="setVal(row.key, $event)"
        />
        <ComfyTVText
          v-else
          :model-value="row.value == null ? '' : String(row.value)"
          @update:model-value="setVal(row.key, $event)"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import ComfyTVNumber from '@/components/widgets/ComfyTVNumber.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import ComfyTVSlider from '@/components/widgets/ComfyTVSlider.vue'
import ComfyTVText from '@/components/widgets/ComfyTVText.vue'
import ComfyTVToggle from '@/components/widgets/ComfyTVToggle.vue'
import { getStageMeta } from '@/composables/stages/stageMeta'
import { useBoundOptionMeta } from '@/composables/stages/useBoundOptionMeta'
import { useCustomParams } from '@/composables/stages/useCustomParams'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  state: StageState
  node: LGraphNode
}>()

const {
  hasWidget,
  attached,
  dynamicAttached,
  boundKeys,
  defLabel,
  defType,
  cfg,
  cfgNum,
  cfgStr,
  numVal,
  useSlider,
  comboOptions,
  setVal,
  ensureDynamic,
} = useCustomParams(props.node, () => props.state)

const workflowKind = computed(() =>
  getStageMeta(props.node.comfyClass ?? '')?.workflow_kind || props.state.kind)

const { metaByKey } = useBoundOptionMeta(() => props.node, workflowKind)

watch(
  [boundKeys, metaByKey, attached],
  () => {
    const defKeys = new Set(attached.value.map(it => it.key))
    const widgetNames = new Set(
      ((props.node.widgets ?? []) as any[])
        .map(w => String(w?.name ?? ''))
        .filter(Boolean),
    )
    for (const key of boundKeys.value) {
      if (defKeys.has(key) || widgetNames.has(key)) continue
      const meta = metaByKey.value.get(key)
      const fallback =
        meta?.control === 'toggle' ? false
          : meta?.control === 'number' ? (meta.min ?? 0)
            : meta?.control === 'combo' ? (meta.options?.[0] ?? '')
              : ''
      ensureDynamic(key, fallback)
    }
  },
  { immediate: true, deep: true },
)

const dynamicRows = computed(() => {
  const byKey = new Map(dynamicAttached.value.map(it => [it.key, it]))
  const out: Array<{
    key: string
    label: string
    control: 'toggle' | 'number' | 'combo' | 'text'
    value: unknown
    options?: string[]
    min?: number
    max?: number
    step?: number
  }> = []
  for (const key of boundKeys.value) {
    const item = byKey.get(key)
    if (!item) continue
    const meta = metaByKey.value.get(key)
    out.push({
      key,
      label: meta?.label ?? key,
      control: meta?.control ?? 'text',
      value: item.value,
      options: meta?.options,
      min: meta?.min,
      max: meta?.max,
      step: meta?.step,
    })
  }
  return out
})

const sectionLabel = 'ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:opacity-60'
</script>
