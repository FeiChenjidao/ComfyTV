<template>
  <div class="v2-ed" @pointerdown.stop>
    <div class="v2-ed__canvas">
      <div class="v2-ed__fit">
        <img
          v-if="sourceImageUrl"
          :src="sourceImageUrl"
          :style="previewStyle"
          draggable="false"
          @dragstart.prevent
        />
      </div>
      <div v-if="!sourceImageUrl" class="v2-ed__empty">{{ $t('imageCrop.noInputImage') }}</div>
    </div>

    <div class="v2-ed__panel">
      <div class="v2-ed__row">
        <span class="v2-ed__label">{{ $t('rotate.angle') }}</span>
        <input
          type="range"
          class="v2-ed__range"
          min="-180" max="180" step="1"
          :value="angle"
          @input="angle = Number(($event.target as HTMLInputElement).value)"
        />
        <input
          type="number"
          class="v2-ed__num"
          min="-180" max="180" step="1"
          :value="angle"
          @change="onAngleNum"
        />
      </div>
      <div class="v2-ed__chips">
        <button
          v-for="q in SNAPS"
          :key="q.l"
          type="button"
          class="v2-ed__chip"
          :data-on="angle === q.d ? '1' : ''"
          @click="angle = q.d"
        >{{ q.l }}</button>
      </div>
      <div class="v2-ed__chips">
        <button
          type="button"
          class="v2-ed__chip"
          :data-on="flipH ? '1' : ''"
          @click="flipH = !flipH"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v16" stroke-dasharray="2.2 2.2"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>
          {{ $t('mirror.horizontal') }}
        </button>
        <button
          type="button"
          class="v2-ed__chip"
          :data-on="flipV ? '1' : ''"
          @click="flipV = !flipV"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h16" stroke-dasharray="2.2 2.2"/><path d="M8 8l4-4 4 4M8 16l4 4 4-4"/></svg>
          {{ $t('mirror.vertical') }}
        </button>
      </div>
    </div>

    <div class="v2-ed__status">
      <span class="v2-ed__spacer" />
      <span v-if="!sourceImageUrl">{{ $t('imageCrop.noInputImage') }}</span>
      <span v-else-if="computing" class="v2-ed__busy">{{ $t('v2.applying') }}</span>
      <span v-else-if="state.output" class="v2-ed__ok">{{ $t('v2.appliedLive') }}</span>
      <span v-else>{{ $t('rotate.adjustToApply') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import { rotatePreviewStyle, rotateToCanvas } from '@/composables/stages/imageOrientPreview'
import { pickSourceImageUrl } from '@/composables/stages/stageInputs'
import { useTransformPipeline } from '@/composables/widgets/useTransformPipeline'
import { useBoolWidget, useNumWidget } from '@/composables/widgets/useWidgetModel'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const SNAPS = [
  { d: -90, l: '⟲ 90°' },
  { d: 0, l: '0°' },
  { d: 180, l: '180°' },
  { d: 90, l: '⟳ 90°' },
] as const

const props = defineProps<{
  node: LGraphNode
  state: StageState
}>()

const sourceImageUrl = computed(() => pickSourceImageUrl(props.state.inputs))
const angle = useNumWidget(props.node, 'angle', 0)
const flipH = useBoolWidget(props.node, 'flip_horizontal', false)
const flipV = useBoolWidget(props.node, 'flip_vertical', false)
const previewStyle = computed(() => rotatePreviewStyle(angle.value, flipH.value, flipV.value))

const { computing, requestRecompute } = useTransformPipeline({
  sourceImageUrl,
  state: props.state,
  nodeId: props.node?.id ?? 'unknown',
  filenamePrefix: 'comfytv-rotate',
  subfolder: 'comfytv/transformer',
  compute: (img) => rotateToCanvas(img, angle.value, flipH.value, flipV.value),
})

function onAngleNum(e: Event) {
  const el = e.target as HTMLInputElement
  const v = Number(el.value)
  if (el.value.trim() !== '' && Number.isFinite(v)) {
    angle.value = Math.max(-180, Math.min(180, Math.round(v)))
  }
  el.value = String(angle.value)
}

watch([angle, flipH, flipV], () => requestRecompute())
watch(sourceImageUrl, (url) => {
  if (url) requestRecompute()
}, { immediate: true })
</script>
