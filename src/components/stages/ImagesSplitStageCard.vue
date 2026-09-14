<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-full ctv:grow">
    <ImagesSplitPreview
      :items="items"
      :truncated="truncated"
      :connected="connected"
      :max="max"
      :selected-set="selectedSet"
      @select="selectItem"
    />
    <button type="button" :class="btnClass" :disabled="!canMerge" @click="mergeSelected">
      {{ $t('imagesSplit.merge') }}
    </button>
    <button type="button" :class="btnClass" :disabled="!canVariations" @click="spawnVariations">
      {{ $t('imagesSplit.variations') }}
    </button>
    <div v-if="actionError" class="ctv:text-2xs ctv:text-center ctv:text-destructive-background">
      {{ actionError }}
    </div>
    <StageCard
      :state="state"
      :node="node"
      :on-run-request="onRunRequest"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
      hide-prompt
      hide-context
      hide-run
      hide-output
    />
  </div>
</template>

<script setup lang="ts">
import StageCard from '@/components/stages/StageCard.vue'
import ImagesSplitPreview from '@/components/stages/ImagesSplitPreview.vue'
import { useImagesSplit } from '@/composables/stages/useImagesSplit'
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

const {
  items, truncated, connected, max,
  selectedSet, canMerge, canVariations, actionError,
  selectItem, mergeSelected, spawnVariations,
} = useImagesSplit(props.node, props.state)

const btnClass = [
  'ctv:flex ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:w-full ctv:py-1 ctv:px-1.5 ctv:rounded ctv:text-xs ctv:cursor-pointer ctv:border',
  'ctv:bg-secondary-background ctv:border-border-subtle ctv:text-base-foreground',
  'ctv:hover:bg-secondary-background-hover',
  'ctv:disabled:opacity-40 ctv:disabled:cursor-default',
].join(' ')
</script>
