<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:size-full">
    <ImageCompare
      class="ctv:flex-1 ctv:min-h-0"
      :before-image="imageA"
      :after-image="imageB"
    />

    <div class="ctv:shrink-0">
      <StageCard
        :state="state"
        :node="node"
        :on-run-request="onRunRequest"
        :on-cancel-request="onCancelRequest"
        :on-disconnect="onDisconnect"
        :on-action="onAction"
        hide-output
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { resolveCompareSlot } from '@/composables/stages/stageInputs'
import StageCard from '@/components/stages/StageCard.vue'
import ImageCompare from '@/components/widgets/ImageCompare.vue'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const imageA = computed(() => resolveCompareSlot(props.state.inputs, 'image_a').url)
const imageB = computed(() => resolveCompareSlot(props.state.inputs, 'image_b').url)
</script>
