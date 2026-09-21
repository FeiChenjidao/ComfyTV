<template>
  <div ref="rootEl" class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:size-full">
    <MainPromptInput :node="node" />

    <div class="ctv:flex ctv:flex-col ctv:gap-0.5">
      <ImageReferences :node="node" :force-types="['image', 'video', 'audio']" />
      <span class="ctv:text-3xs ctv:text-muted-foreground/70">
        {{ $t('director.sharedRefsHint') }}
      </span>
    </div>

    <div class="ctv:flex ctv:items-center ctv:gap-2">
      <span class="ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
        {{ $t('director.clips') }}
      </span>
      <span class="ctv:text-2xs ctv:font-mono ctv:text-muted-foreground">
        {{ clips.length }} · {{ totalSeconds }}s
      </span>
      <button
        type="button" class="icon-btn"
        :disabled="!previewCanPlay"
        :title="!previewCanPlay ? $t('director.playDisabled')
          : previewPlaying ? $t('director.pause') : $t('director.play')"
        @click="togglePlay"
      ><i :class="['pi', previewPlaying ? 'pi-pause' : 'pi-play']" /></button>
      <label class="ctv:ml-auto ctv:flex ctv:items-center ctv:gap-1 ctv:text-2xs ctv:text-muted-foreground"
             :title="$t('director.chainTooltip')">
        {{ $t('director.chain') }}
        <select
          class="ctv:py-0.5 ctv:px-1 ctv:rounded ctv:text-2xs
                 ctv:bg-secondary-background ctv:text-base-foreground ctv:border ctv:border-border-subtle"
          :value="settings.chain"
          @change="(e) => setChainMode((e.target as HTMLSelectElement).value as ChainMode)"
        >
          <option v-for="m in CHAIN_MODES" :key="m" :value="m">{{ $t(`director.chainMode.${m}`) }}</option>
        </select>
      </label>
    </div>

    <DirectorTrack
      :clips="clips"
      :selected-id="selectedId"
      :drag="drag"
      :statuses="statuses"
      :track-width-px="trackWidthPx"
      :clip-style="clipStyle"
      :ruler-ticks="rulerTicks"
      :preview-active="previewActive"
      :preview-playing="previewPlaying"
      :preview-can-play="previewCanPlay"
      :playhead-px="playheadPx"
      :on-ruler-pointer-down="onRulerPointerDown"
      :on-clip-pointer-down="onClipPointerDown"
      :on-resize-pointer-down="onResizePointerDown"
      :on-add-clip="addClip"
    />

    <div v-if="previewActive" class="ctv:flex ctv:flex-col ctv:gap-1">
      <div class="ctv:flex ctv:items-center ctv:gap-2">
        <span class="ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
          {{ previewMode === 'film' ? $t('director.filmPreview') : $t('director.clipsPreview') }}
        </span>
        <span class="ctv:text-2xs ctv:font-mono ctv:text-muted-foreground">
          {{ playheadS.toFixed(1) }}s / {{ previewTotalS }}s
        </span>
        <button type="button" class="icon-btn ctv:ml-auto" :title="$t('stage.action.close')" @click="closePreview">
          <i class="pi pi-times" />
        </button>
      </div>
      <div ref="previewWrapEl">
        <ValuePreview
          type="COMFYTV_VIDEO"
          :content="previewSrc || null"
          :empty-label="$t('stage.empty.no_output')"
        />
      </div>
    </div>

    <div v-if="selectedClip" class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:rounded-md ctv:border ctv:border-border-subtle ctv:p-1.5">
      <div class="ctv:flex ctv:items-center ctv:gap-1.5">
        <label class="ctv:flex ctv:items-center ctv:gap-1 ctv:text-2xs ctv:text-muted-foreground ctv:cursor-pointer">
          <input type="checkbox" :checked="selectedClip.enabled"
                 @change="(e) => updateClip(selectedClip!.id, { enabled: (e.target as HTMLInputElement).checked })" />
          {{ $t('director.enabled') }}
        </label>
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('director.workflow') }}</span>
        <select
          class="ctv:flex-1 ctv:min-w-0 ctv:py-0.5 ctv:px-1 ctv:rounded ctv:text-xs
                 ctv:bg-secondary-background ctv:text-base-foreground ctv:border ctv:border-border-subtle"
          :value="selectedClip.workflow"
          @change="(e) => updateClip(selectedClip!.id, { workflow: (e.target as HTMLSelectElement).value })"
        >
          <option value="">{{ $t('director.workflowDefault') }}</option>
          <option v-for="w in workflowOptions" :key="w" :value="w">{{ w }}</option>
        </select>
        <button
          v-if="statuses.get(selectedClip.id)"
          type="button" class="icon-btn"
          :disabled="state.running"
          :title="$t('director.rerunClip')"
          @click="rerunClip(selectedClip.id)"
        ><i class="pi pi-replay" /></button>
        <button type="button" class="icon-btn" :title="$t('director.duplicateClip')"
                @click="duplicateClip(selectedClip.id)"><i class="pi pi-clone" /></button>
        <button type="button" class="icon-btn" :title="$t('director.deleteClip')"
                @click="removeClip(selectedClip.id)"><i class="pi pi-trash" /></button>
      </div>

      <div class="ctv:flex ctv:flex-col ctv:gap-1">
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('director.clipPrompt') }}</span>
        <ClipPromptEditor
          :key="selectedClip.id"
          :model-value="selectedClip.prompt"
          :placeholder="$t('director.promptPlaceholder')"
          :source="clipSource"
          @update:model-value="(v) => updateClip(selectedClip!.id, { prompt: v })"
        />
      </div>

      <div v-if="selectedIndex > 0" class="ctv:flex ctv:items-center ctv:gap-2">
        <span class="ctv:text-2xs ctv:text-muted-foreground" :title="$t('director.transitionTooltip')">
          {{ $t('director.transition') }}
        </span>
        <select
          class="ctv:py-0.5 ctv:px-1 ctv:rounded ctv:text-xs
                 ctv:bg-secondary-background ctv:text-base-foreground ctv:border ctv:border-border-subtle"
          :value="selectedClip.transition"
          @change="(e) => updateClip(selectedClip!.id, { transition: (e.target as HTMLSelectElement).value })"
        >
          <option v-for="tr in TRANSITIONS" :key="tr" :value="tr">{{ tr }}</option>
        </select>
        <template v-if="selectedClip.transition !== 'cut'">
          <input
            type="number" min="0.1" max="5" step="0.1"
            class="ctv:w-14 ctv:py-0.5 ctv:px-1 ctv:rounded ctv:text-xs ctv:font-mono
                   ctv:bg-secondary-background ctv:text-base-foreground ctv:border ctv:border-border-subtle"
            :value="selectedClip.transition_s"
            @change="(e) => updateClip(selectedClip!.id, { transition_s: Number((e.target as HTMLInputElement).value) })"
          />
          <span class="ctv:text-2xs ctv:text-muted-foreground">s</span>
        </template>
      </div>

      <div class="ctv:flex ctv:items-center ctv:gap-2">
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('director.duration') }}</span>
        <input
          type="number" min="1" max="120" step="1"
          class="ctv:w-14 ctv:py-0.5 ctv:px-1 ctv:rounded ctv:text-xs ctv:font-mono
                 ctv:bg-secondary-background ctv:text-base-foreground ctv:border ctv:border-border-subtle"
          :value="selectedClip.duration_s"
          @change="(e) => updateClip(selectedClip!.id, { duration_s: Number((e.target as HTMLInputElement).value) })"
        />
        <button
          v-if="statuses.get(selectedClip.id)?.url"
          type="button" class="icon-btn ctv:ml-auto" :title="$t('director.previewClip')"
          @click="previewUrl = statuses.get(selectedClip!.id)!.url"
        ><i class="pi pi-play-circle" /></button>
      </div>

      <DirectorClipRefs
        :node="node"
        :clip="selectedClip"
        :shared-urls="sharedUrls"
        :workflow-label="clipWorkflowLabel"
        :on-add-ref="(kind, url) => addRef(selectedClip!.id, kind, url)"
        :on-remove-ref="(kind, url) => removeRef(selectedClip!.id, kind, url)"
        :on-move-ref-to="(kind, from, to) => moveRefTo(selectedClip!.id, kind, from, to)"
      />
    </div>
    <div v-else-if="clips.length === 0" class="ctv:text-xs ctv:text-muted-foreground/70 ctv:p-1">
      {{ $t('director.empty') }}
    </div>

    <div v-if="previewUrl" class="ctv:flex ctv:flex-col ctv:gap-1">
      <div class="ctv:flex ctv:items-center">
        <span class="ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
          {{ $t('director.clipPreview') }}
        </span>
        <button type="button" class="icon-btn ctv:ml-auto" @click="previewUrl = ''">
          <i class="pi pi-times" />
        </button>
      </div>
      <video :src="previewUrl" controls class="ctv:w-full ctv:max-h-48 ctv:rounded ctv:bg-black" />
    </div>

    <StageCard
      :state="state"
      :node="node"
      :on-run-request="onDirectorRun"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
      hide-context
      hide-prompt
      hide-output
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import ClipPromptEditor from '@/components/stages/ClipPromptEditor.vue'
import DirectorClipRefs from '@/components/stages/DirectorClipRefs.vue'
import DirectorTrack from '@/components/stages/DirectorTrack.vue'
import ImageReferences from '@/components/stages/ImageReferences.vue'
import MainPromptInput from '@/components/stages/MainPromptInput.vue'
import StageCard from '@/components/stages/StageCard.vue'
import ValuePreview from '@/components/stages/ValuePreview.vue'
import { clipMentionSource } from '@/composables/stages/directorMentions'
import type { SharedUrls } from '@/composables/stages/directorRefs'
import { useDirectorPlayback } from '@/composables/stages/useDirectorPlayback'
import { MEDIA_TYPES, readMediaTable } from '@/composables/stages/mediaOrder'
import { mediaEntryUrl } from '@/composables/stages/mediaOrderSync'
import {
  CHAIN_MODES,
  TRANSITIONS,
  useDirectorTimeline,
  type ChainMode,
} from '@/composables/stages/useDirectorTimeline'
import type { LGraphNode } from '@/lib/comfyApp'
import { useSelectionStore } from '@/stores/selectionStore'
import { bindWidgetCallback, onNodeConfigure, readWidgetStr } from '@/utils/widget'
import type { StageState } from '@/stores/stageStore'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const rootEl = ref<HTMLElement | null>(null)
const previewUrl = ref('')
const selectionStore = useSelectionStore()

function rerunClip(id: string) {
  if (props.state.running) return
  rerollSeed(id)
  props.onRunRequest()
}

function runFingerprint(): string {
  return JSON.stringify([
    readWidgetStr(props.node, 'timeline_data', ''),
    defaultWorkflow.value,
    readWidgetStr(props.node, 'resolution', ''),
    readWidgetStr(props.node, 'aspect_ratio', ''),
    String((props.node as any)?.widgets?.find((w: any) => w.name === 'generate_audio')?.value ?? ''),
    readWidgetStr(props.node, 'main_prompt', ''),
    sharedUrls.value,
  ])
}

let lastSuccessFingerprint = ''

watch(() => props.state.directorClips, () => {
  if (props.state.directorClips && !props.state.error) {
    lastSuccessFingerprint = runFingerprint()
  }
})

function maybeRerollForRepeat() {
  if (!props.state.running
      && lastSuccessFingerprint
      && !props.state.error
      && runFingerprint() === lastSuccessFingerprint) {
    rerollAllSeeds()
  }
}

let unregisterPreRun: (() => void) | null = null
onMounted(() => {
  unregisterPreRun =
    (props.node as any).__comfytvStageApi?.registerPreRun?.(maybeRerollForRepeat) ?? null
})
onUnmounted(() => { unregisterPreRun?.() })

function onDirectorRun() {
  if (!unregisterPreRun) maybeRerollForRepeat()
  props.onRunRequest()
}

const {
  clips, settings, selectedId, drag,
  selectedClip, selectedIndex, totalSeconds, statuses, workflowOptions,
  trackWidthPx,
  clipStyle,
  addClip, removeClip, duplicateClip, updateClip, rerollSeed,
  rerollAllSeeds,
  setChainMode,
  addRef, removeRef, moveRefTo,
  onClipPointerDown, onResizePointerDown,
} = useDirectorTimeline(props.node, props.state, rootEl)

const clipSource = clipMentionSource(
  () => selectedClip.value,
  () => sharedUrls.value,
)

const previewWrapEl = ref<HTMLElement | null>(null)

const {
  active: previewActive,
  playing: previewPlaying,
  playheadS,
  playheadPx,
  ticks: rulerTicks,
  totalS: previewTotalS,
  canPlay: previewCanPlay,
  mode: previewMode,
  currentSrc: previewSrc,
  open: openPreview,
  close: closePreview,
  togglePlay,
  onRulerPointerDown,
  onLoadedMetadata: onPreviewLoadedMetadata,
  onTimeUpdate: onPreviewTimeUpdate,
  onEnded: onPreviewEnded,
  onPlay: onPreviewPlay,
  onPause: onPreviewPause,
} = useDirectorPlayback({
  clips,
  statuses: () => statuses.value,
  filmUrl: () => String(props.state.output ?? ''),
  video: () => previewWrapEl.value?.querySelector('video') ?? null,
})

watch([previewActive, previewWrapEl], (_, __, onCleanup) => {
  const el = previewWrapEl.value?.querySelector('video')
  if (!previewActive.value || !el) return
  const pairs: Array<[string, EventListener]> = [
    ['loadedmetadata', onPreviewLoadedMetadata],
    ['timeupdate', onPreviewTimeUpdate],
    ['ended', onPreviewEnded],
    ['play', onPreviewPlay],
    ['pause', onPreviewPause],
  ]
  pairs.forEach(([t, h]) => el.addEventListener(t, h))
  onCleanup(() => pairs.forEach(([t, h]) => el.removeEventListener(t, h)))
}, { flush: 'post' })

watch(() => props.state.output, (v) => {
  if (String(v ?? '').trim()) openPreview()
}, { immediate: true })

const defaultWorkflow = ref(readWidgetStr(props.node, 'workflow', ''))
bindWidgetCallback(props.node, 'workflow', (v) => {
  defaultWorkflow.value = String(v ?? '')
})
onNodeConfigure(props.node, () => {
  defaultWorkflow.value = readWidgetStr(props.node, 'workflow', '')
})

const clipWorkflowLabel = computed(() =>
  selectedClip.value?.workflow || defaultWorkflow.value,
)

const sharedUrls = computed<SharedUrls>(() => {
  void selectionStore.bindingsVersion
  const out: SharedUrls = { images: [], videos: [], audio: [] }
  const bucket = { image: 'images', video: 'videos', audio: 'audio' } as const
  const table = readMediaTable(props.node)
  for (const type of MEDIA_TYPES) {
    for (const e of table[type]) {
      if (e.src === 'link') continue
      const url = mediaEntryUrl(props.node, e)
      if (url) out[bucket[type]].push(url)
    }
  }
  return out
})
</script>

<style scoped>
.icon-btn {
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--muted-foreground, #999);
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 12px;
}
.icon-btn:hover,
.icon-btn:focus-visible {
  color: var(--base-foreground, #eee);
  background: rgba(255, 255, 255, 0.08);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}
</style>
