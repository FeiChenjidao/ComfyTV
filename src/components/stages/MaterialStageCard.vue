<template>
  <div
    class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-full ctv:grow ctv:p-2 ctv:box-border ctv:text-xs ctv:text-base-foreground"
    @pointerdown.stop
    @mousedown.stop
    @contextmenu.stop.prevent
  >
    <div class="ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-[200px] ctv:rounded-lg ctv:overflow-hidden ctv:bg-black">
      <MaterialSphere ref="sphereEl" class="ctv:absolute! ctv:inset-0" :params="params" @rendered="scheduleCapture" />
    </div>

    <div class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1">
      <span class="ctv:text-3xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
        {{ $t('materialStage.presets') }}
      </span>
      <button
        v-for="p in MATERIAL_PRESETS"
        :key="p.key"
        type="button"
        :class="presetChipClass"
        @click="applyPreset(p)"
      >{{ $t(`materialStage.preset.${p.key}`) }}</button>
    </div>

    <div
      class="ctv:flex ctv:flex-col ctv:gap-1"
      @pointerdown.stop
      @pointermove.stop
      @pointerup.stop
    >
      <div class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:text-[11px]">
        <span :class="paramLabelClass">{{ $t('materialStage.color') }}</span>
        <input
          type="color"
          class="ctv:h-6 ctv:w-10 ctv:p-0 ctv:cursor-pointer ctv:rounded ctv:border ctv:border-border-subtle ctv:bg-transparent"
          :value="params.color"
          @input="(e) => setColor((e.target as HTMLInputElement).value)"
        />
        <input
          type="text"
          class="ctv-num-input ctv:w-20 ctv:py-0.5 ctv:px-1 ctv:text-[11px] ctv:font-mono ctv:rounded
                 ctv:bg-secondary-background ctv:border ctv:border-border-subtle ctv:text-base-foreground"
          :value="params.color"
          @change="(e) => setColor((e.target as HTMLInputElement).value)"
        />
        <span
          v-if="params.map"
          class="ctv:text-3xs ctv:text-primary-background"
          :title="params.map"
        >× {{ $t('materialStage.mapSlot.map') }}</span>
      </div>

      <div class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1 ctv:py-0.5">
        <span :class="paramLabelClass">{{ $t('materialStage.maps') }}</span>
        <span
          v-if="!liveMaps.length"
          class="ctv:text-2xs ctv:italic ctv:text-muted-foreground"
        >{{ $t('materialStage.mapHint') }}</span>
        <span
          v-for="key in liveMaps"
          :key="key"
          class="ctv:inline-flex ctv:items-center ctv:gap-0.5 ctv:rounded ctv:border ctv:border-border-subtle
                 ctv:bg-secondary-background ctv:px-1.5 ctv:py-0.5 ctv:text-3xs ctv:text-base-foreground"
          :title="params[key] || ''"
        >{{ $t(`materialStage.mapSlot.${key}`) }}</span>
      </div>

      <FxSlider
        v-for="s in visibleSliders"
        :key="s.key"
        :model-value="params[s.key]"
        :label="sliderLabel(s.key)"
        :min="s.min"
        :max="s.max"
        :step="s.step"
        :decimals="2"
        @update:model-value="(v) => setParam(s.key, v)"
      />
    </div>

    <StageCard
      class="ctv:h-auto! ctv:grow-0 ctv:shrink-0"
      :state="state"
      :node="node"
      :on-run-request="onRunRequest"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
      hide-context
      hide-output
      hide-actions
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { LGraphNode } from '@/lib/comfyApp'
import MaterialSphere from '@/components/widgets/MaterialSphere.vue'
import StageCard from '@/components/stages/StageCard.vue'
import FxSlider from '@/components/widgets/fx/FxSlider.vue'
import type { StageState } from '@/stores/stageStore'
import {
  CAPTURE_SIZE,
  MATERIAL_SLIDERS as SLIDERS,
  useMaterialStage,
  type MaterialSliderKey,
} from '@/composables/stages/useMaterialStage'
import {
  MATERIAL_MAP_KEYS,
  MATERIAL_PRESETS,
  MATERIAL_SCALAR_MAP,
  type MaterialMapKey,
} from '@/widgets/material/types'

const { t } = useI18n()

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const sphereEl = ref<InstanceType<typeof MaterialSphere> | null>(null)

const {
  params,
  setParam,
  setColor,
  applyPreset,
  scheduleCapture,
  teardown,
} = useMaterialStage(props.node, {
  getState: () => props.state,
  captureCanvas: () => sphereEl.value?.captureCanvas(CAPTURE_SIZE, CAPTURE_SIZE) ?? null,
})

const liveMaps = computed(() =>
  MATERIAL_MAP_KEYS.filter((k) => !!params[k]),
)

const visibleSliders = computed(() =>
  SLIDERS.filter((s) => !s.whenMap || !!params[s.whenMap]),
)

function sliderLabel(key: MaterialSliderKey): string {
  const base = t(`materialStage.param.${key}`)
  const mapKey = MATERIAL_SCALAR_MAP[key as keyof typeof MATERIAL_SCALAR_MAP] as MaterialMapKey | undefined
  if (mapKey && params[mapKey]) return `${base} ×`
  return base
}

onBeforeUnmount(() => {
  teardown()
})

const paramLabelClass = 'ctv:w-20 ctv:shrink-0 ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground'

const presetChipClass =
  'ctv:inline-flex ctv:items-center ctv:cursor-pointer ctv:[font-family:inherit] ' +
  'ctv:rounded-lg ctv:border ctv:border-border-subtle ctv:bg-secondary-background ctv:px-2 ctv:py-0.5 ' +
  'ctv:text-2xs ctv:text-muted-foreground ctv:transition-colors ' +
  'ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground'
</script>
