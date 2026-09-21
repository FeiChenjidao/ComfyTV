<template>
  <div ref="trackScrollEl" class="ctv:shrink-0 ctv:overflow-x-auto ctv:overflow-y-hidden ctv:rounded-md ctv:border ctv:border-border-subtle ctv:bg-black">
    <div class="ctv:relative ctv:m-1" :style="{ width: `${trackWidthPx}px` }">
      <div
        class="ctv:relative ctv:h-4 ctv:border-b ctv:border-white/10 ctv:touch-none"
        :class="previewCanPlay ? 'ctv:cursor-pointer' : ''"
        @pointerdown="onRulerPointerDown"
      >
        <div
          v-for="(tick, i) in rulerTicks"
          :key="i"
          class="ctv:absolute ctv:top-0 ctv:border-l ctv:pointer-events-none"
          :class="tick.major ? 'ctv:h-4 ctv:border-white/30' : 'ctv:h-1.5 ctv:border-white/15'"
          :style="{ left: `${tick.px}px` }"
        >
          <span v-if="tick.label" class="ctv:text-[8px] ctv:text-white/40 ctv:ml-0.5">{{ tick.label }}</span>
        </div>
      </div>
      <div class="ctv:relative ctv:h-[72px] ctv:mt-0.5">
        <div
          v-for="(clip, idx) in clips"
          :key="clip.id"
          class="ctv:absolute ctv:top-0.5 ctv:h-16 ctv:rounded ctv:border ctv:overflow-hidden
                 ctv:flex ctv:flex-col ctv:justify-between ctv:py-0.5 ctv:px-1 ctv:select-none"
          :class="[
            clip.enabled ? 'ctv:border-primary-background/50 ctv:bg-primary-background/15'
                         : 'ctv:border-border-subtle ctv:bg-white/5 ctv:opacity-50',
            clip.id === selectedId ? 'ctv:border-primary-background ctv:shadow-[0_0_0_1px_var(--primary-background)]' : '',
            drag?.id === clip.id && drag?.active ? 'ctv:opacity-80 ctv:cursor-grabbing ctv:z-[5]' : 'ctv:cursor-grab',
          ]"
          :style="clipStyle(idx)"
          @pointerdown="onClipPointerDown($event, clip, idx)"
        >
          <div class="ctv:flex ctv:items-center ctv:gap-1 ctv:pointer-events-none">
            <i v-if="idx > 0 && clip.transition !== 'cut'"
               class="pi pi-arrow-right-arrow-left ctv:text-3xs ctv:text-white/60"
               :title="clip.transition" />
            <span class="ctv:text-3xs ctv:font-mono ctv:text-white/50">#{{ idx + 1 }}</span>
            <span class="ctv:text-3xs ctv:truncate ctv:text-white/80">
              {{ clip.workflow || $t('director.workflowDefault') }}
            </span>
          </div>
          <div class="ctv:text-2xs ctv:truncate ctv:text-white/60 ctv:pointer-events-none">
            {{ clip.prompt || $t('director.promptPlaceholder') }}
          </div>
          <div class="ctv:flex ctv:items-center ctv:gap-1 ctv:pointer-events-none">
            <span class="ctv:text-3xs ctv:font-mono ctv:py-0 ctv:px-0.5 ctv:rounded-sm ctv:bg-black/60 ctv:text-white/90">
              {{ clip.duration_s }}s
            </span>
            <i v-if="statuses.get(clip.id)?.cached" class="pi pi-check-circle ctv:text-3xs ctv:text-success-background"
               :title="$t('director.cached')" />
            <i v-else-if="statuses.get(clip.id)" class="pi pi-circle-fill ctv:text-3xs ctv:text-primary-background"
               :title="$t('director.generated')" />
            <span v-if="refCount(clip)" class="ctv:text-3xs ctv:text-white/50">
              <i class="pi pi-paperclip ctv:text-3xs" /> {{ refCount(clip) }}
            </span>
          </div>
          <div
            class="ctv:absolute ctv:top-0 ctv:right-0 ctv:w-2 ctv:h-full ctv:cursor-ew-resize ctv:bg-white/10 clip-resize"
            @pointerdown.stop="onResizePointerDown($event, clip)"
          />
        </div>
        <button
          type="button"
          class="ctv:absolute ctv:top-0.5 ctv:h-16 ctv:w-8 ctv:rounded ctv:border ctv:border-dashed ctv:border-border-subtle
                 ctv:bg-transparent ctv:text-muted-foreground ctv:cursor-pointer add-clip"
          :style="{ left: `${trackWidthPx - 36}px` }"
          :title="$t('director.addClip')"
          @click="onAddClip"
        ><i class="pi pi-plus" /></button>
      </div>
      <div
        v-if="previewActive"
        class="ctv:absolute ctv:top-0 ctv:bottom-0 ctv:w-px ctv:bg-primary-background ctv:pointer-events-none ctv:z-10"
        :style="{ left: `${playheadPx}px` }"
      >
        <div class="playhead-cap" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, type StyleValue } from 'vue'

import { refCount } from '@/composables/stages/directorRefs'
import type { RulerTick } from '@/composables/stages/useDirectorPlayback'
import type {
  DirectorClip,
  DirectorClipStatus,
} from '@/composables/stages/useDirectorTimeline'

const props = defineProps<{
  clips: DirectorClip[]
  selectedId: string | null
  drag: { id: string; active: boolean } | null
  statuses: Map<string, DirectorClipStatus>
  trackWidthPx: number
  clipStyle: (idx: number) => StyleValue
  rulerTicks: RulerTick[]
  previewActive: boolean
  previewPlaying: boolean
  previewCanPlay: boolean
  playheadPx: number
  onRulerPointerDown: (e: PointerEvent) => void
  onClipPointerDown: (e: PointerEvent, clip: DirectorClip, idx: number) => void
  onResizePointerDown: (e: PointerEvent, clip: DirectorClip) => void
  onAddClip: () => void
}>()

const trackScrollEl = ref<HTMLElement | null>(null)

watch(() => props.playheadPx, (px) => {
  if (!props.previewPlaying) return
  const el = trackScrollEl.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  const lo = el.scrollLeft + 24
  const hi = el.scrollLeft + el.clientWidth - 24
  if (px < lo || px > hi) el.scrollLeft = Math.max(0, px - el.clientWidth / 2)
})
</script>

<style scoped>
.clip-resize:hover {
  background: rgba(255, 255, 255, 0.3);
}
.add-clip:hover {
  color: var(--base-foreground, #eee);
  border-color: var(--primary-background, #4a9);
}
.playhead-cap {
  position: absolute;
  top: 0;
  left: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid var(--primary-background, #4a9);
}
</style>
