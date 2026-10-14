<template>
  <div class="v2-ed" @pointerdown.stop>
    <div class="v2-ed__canvas">
      <ImageCompare
        class="v2-cmp__fill"
        :before-image="imageA"
        :after-image="imageB"
      />
      <div v-if="!imageA && !imageB" class="v2-ed__empty">{{ $t('v2.ed.compareHint') }}</div>
    </div>

    <div class="v2-ed__status">
      <span class="v2-ed__dims">A</span>
      <span :class="wiredA ? 'v2-ed__ok' : ''">{{ wiredA ? $t('v2.ed.wired') : $t('v2.ed.empty') }}</span>
      <span class="v2-ed__spacer" />
      <span class="v2-ed__dims">B</span>
      <span :class="wiredB ? 'v2-ed__ok' : ''">{{ wiredB ? $t('v2.ed.wired') : $t('v2.ed.empty') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { resolveCompareSlot } from '@/composables/stages/stageInputs'
import ImageCompare from '@/components/widgets/ImageCompare.vue'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  node: LGraphNode
  state: StageState
}>()

const slotA = computed(() => resolveCompareSlot(props.state.inputs, 'image_a'))
const slotB = computed(() => resolveCompareSlot(props.state.inputs, 'image_b'))

const imageA = computed(() => slotA.value.url)
const imageB = computed(() => slotB.value.url)
const wiredA = computed(() => slotA.value.wired)
const wiredB = computed(() => slotB.value.wired)
</script>

<style scoped>
.v2-cmp__fill {
  position: absolute;
  inset: 0;
}
</style>
