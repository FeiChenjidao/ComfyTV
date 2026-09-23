<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-full ctv:grow">
    <div class="ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-[280px] ctv:rounded-md ctv:overflow-hidden ctv:border ctv:border-border-subtle
                ctv:bg-black">
      <div class="ctv:absolute ctv:inset-0 ctv:flex ctv:items-center ctv:justify-center">
        <div v-if="!previewUrl" class="ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:text-white/50">
          <i class="pi pi-images ctv:text-[32px] ctv:opacity-60" />
          <div class="ctv:text-xs">{{ $t('imageMerge.needImages') }}</div>
        </div>
        <img
          v-else
          :src="previewUrl"
          class="ctv:max-w-full ctv:max-h-full ctv:object-contain ctv:select-none ctv:pointer-events-none"
          draggable="false"
          @dragstart.prevent
        />
      </div>
    </div>

    <div class="ctv:grid ctv:grid-cols-3 ctv:gap-1.5 ctv:text-xs">
      <button
        v-for="opt in MERGE_MODES"
        :key="opt"
        type="button"
        class="ctv:py-1 ctv:px-1.5 ctv:rounded ctv:text-xs ctv:cursor-pointer
               ctv:bg-secondary-background ctv:border ctv:border-border-subtle ctv:text-base-foreground ctv:hover:bg-secondary-background-hover"
        :class="mode === opt ? 'ctv:border-primary' : ''"
        @click="mode = opt"
      >{{ $t(`imageMerge.${opt}`) }}</button>
      <button
        type="button"
        class="ctv:py-1 ctv:px-1.5 ctv:rounded ctv:text-xs ctv:cursor-pointer
               ctv:bg-secondary-background ctv:border ctv:border-border-subtle ctv:text-base-foreground ctv:hover:bg-secondary-background-hover"
        :class="square ? 'ctv:border-primary' : ''"
        @click="square = !square"
      >{{ $t('imageMerge.aspect11') }}</button>
    </div>

    <div class="ctv:text-2xs ctv:text-center ctv:py-0.5 ctv:tracking-wide">
      <span v-if="!inputCount" class="ctv:text-muted-foreground">{{ $t('imageMerge.needImages') }}</span>
      <span v-else-if="computing" class="ctv:text-muted-foreground">{{ $t('imageMerge.applying') }}</span>
      <span v-else-if="state.output" class="ctv:text-success-background">{{ $t('imageMerge.applied') }}</span>
      <span v-else class="ctv:text-muted-foreground">{{ $t('imageMerge.adjustToApply') }}</span>
    </div>

    <StageCard
      :state="state"
      :node="node"
      :on-run-request="onRunRequest"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
    />
  </div>
</template>

<script setup lang="ts">
import StageCard from '@/components/stages/StageCard.vue'
import { MERGE_MODES } from '@/composables/stages/imageMerge'
import { useImageMerge } from '@/composables/stages/useImageMerge'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const { mode, square, previewUrl, computing, inputCount } = useImageMerge(props.node, props.state)
</script>
