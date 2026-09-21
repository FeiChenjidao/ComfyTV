<template>
  <template v-if="type === 'COMFYTV_STORYBOARD'">
    <div v-if="compact" class="ctv:flex ctv:flex-col ctv:gap-0.5 ctv:size-full ctv:py-[3px] ctv:px-1 ctv:box-border ctv:overflow-hidden">
      <div class="ctv:flex ctv:items-baseline ctv:gap-1 ctv:shrink-0">
        <span class="ctv:text-[11px] ctv:leading-none"><i class="pi pi-copy" /></span>
        <span class="vp-sb-count ctv:text-xs ctv:font-bold ctv:leading-none ctv:text-[#d8b0ff]">{{ shots.length }}</span>
        <span v-if="totalSec" class="ctv:ml-auto ctv:text-3xs ctv:tracking-wide ctv:text-muted-foreground">{{ totalSec }}s</span>
      </div>
      <ul class="ctv:list-none ctv:m-0 ctv:p-0 ctv:flex ctv:flex-col ctv:gap-px ctv:flex-auto ctv:min-h-0">
        <li v-for="(shot, i) in shots.slice(0, 3)" :key="i"
            class="vp-sb-item ctv:flex ctv:items-baseline ctv:gap-[3px] ctv:text-3xs ctv:leading-tight ctv:whitespace-nowrap ctv:overflow-hidden">
          <span class="ctv:shrink-0 ctv:font-semibold ctv:text-[#d8b0ff] ctv:min-w-2">{{ shot.shot_no ?? i + 1 }}</span>
          <span class="ctv:flex-auto ctv:overflow-hidden ctv:text-ellipsis ctv:text-base-foreground/80">{{ shotSummary(shot) }}</span>
        </li>
      </ul>
      <div v-if="shots.length > 3" class="vp-sb-more ctv:text-[8px] ctv:text-right ctv:italic ctv:text-muted-foreground/60">
        {{ $t('valuePreview.moreShots', { n: shots.length - 3 }) }}
      </div>
    </div>
    <div v-else :class="storyboardListClass">
      <div v-for="(shot, i) in shots" :key="i" :class="shotRowClass">
        <span :class="shotNoClass">#{{ shot.shot_no ?? i + 1 }}</span>
        <span v-if="shot.duration" :class="shotDurClass">{{ shot.duration }}</span>
        <span :class="shotPromptClass">{{ shot.prompt }}</span>
      </div>
    </div>
  </template>

  <template v-else>
    <div v-if="compact" :class="compactSummary">
      <span class="ctv:text-[22px] ctv:leading-none"><i class="pi pi-video" /></span>
      <span class="vp-compact-count-text ctv:text-sm ctv:font-bold ctv:text-[#d8b0ff]">{{ segments.length }}</span>
    </div>
    <div v-else :class="storyboardListClass">
      <div v-for="(seg, i) in segments" :key="i" :class="shotRowClass">
        <span :class="shotNoClass">#{{ i + 1 }}</span>
        <span v-if="seg.length" :class="shotDurClass">{{ seg.length }}f</span>
        <span :class="shotPromptClass">{{ seg.prompt || '—' }}</span>
      </div>
      <div v-if="segments.length === 0" :class="emptyClass(false)">{{ $t('valuePreview.emptyTimeline') }}</div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { shotSummary, type useValuePreview } from '@/composables/stages/useValuePreview'

import {
  compactSummary,
  emptyClass,
  shotDurClass,
  shotNoClass,
  shotPromptClass,
  shotRowClass,
  storyboardListClass,
} from './valuePreviewClasses'

type Preview = ReturnType<typeof useValuePreview>

defineProps<{
  type: string
  compact?: boolean
  shots: Preview['storyboardShots']['value']
  segments: Preview['timelineSegs']['value']
  totalSec: Preview['storyboardTotalSec']['value']
}>()
</script>
