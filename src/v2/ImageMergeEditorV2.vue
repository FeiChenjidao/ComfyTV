<template>
  <div class="v2-ed" @pointerdown.stop>
    <div class="v2-ed__canvas">
      <div class="v2-ed__fit">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          draggable="false"
          @dragstart.prevent
        />
      </div>
      <div v-if="!previewUrl" class="v2-ed__empty">{{ $t('imageMerge.needImages') }}</div>
    </div>

    <div class="v2-ed__panel">
      <div class="v2-ed__chips">
        <button
          v-for="opt in MERGE_MODES"
          :key="opt"
          type="button"
          class="v2-ed__chip"
          :data-on="mode === opt ? '1' : ''"
          @click="mode = opt"
        >{{ $t(`imageMerge.${opt}`) }}</button>
      </div>
    </div>

    <div class="v2-ed__status">
      <span class="v2-ed__dims">{{ $t('imageMerge.wired', { n: inputCount }) }}</span>
      <span class="v2-ed__spacer" />
      <span v-if="!inputCount">{{ $t('imageMerge.needImages') }}</span>
      <span v-else-if="computing" class="v2-ed__busy">{{ $t('imageMerge.applying') }}</span>
      <span v-else-if="state.output" class="v2-ed__ok">{{ $t('imageMerge.applied') }}</span>
      <span v-else>{{ $t('imageMerge.adjustToApply') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MERGE_MODES } from '@/composables/stages/imageMerge'
import { useImageMerge } from '@/composables/stages/useImageMerge'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  node: LGraphNode
  state: StageState
}>()

const { mode, previewUrl, computing, inputCount } = useImageMerge(props.node, props.state)
</script>
