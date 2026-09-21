<template>
  <div ref="refsEl" class="ctv:relative ctv:flex ctv:flex-col ctv:gap-1">
    <div class="ctv:flex ctv:items-center ctv:gap-2">
      <span class="ctv:text-[11px] ctv:font-semibold">{{ $t('imageRefs.title') }}</span>
      <span class="ctv:text-3xs ctv:text-muted-foreground ctv:font-mono">{{ refCount(clip) || '' }}</span>
      <button
        type="button"
        class="icon-btn ctv:ml-auto"
        :title="pickerOpen ? $t('stage.action.close') : $t('imageRefs.add')"
        @click.stop="openPicker()"
      ><i :class="['pi', pickerOpen ? 'pi-times' : 'pi-plus']" /></button>
    </div>

    <AssetPickerPopup
      v-if="pickerOpen"
      :added-ids="pickerAddedIds"
      :media-types="['image', 'video', 'audio']"
      :batch-groups="batchGroups"
      :added-batch-keys="pickerAddedBatchKeys"
      @select="onPickAsset"
      @deselect="onUnpickAsset"
      @select-batch="onPickBatchImage"
      @deselect-batch="onUnpickBatchImage"
      @refresh-batch="onRefreshBatch"
      @unpin-batch="onUnpinBatch"
      @close="pickerOpen = false"
    />

    <div v-if="refCount(clip)" class="ctv:flex ctv:flex-wrap ctv:gap-1.5">
      <div
        v-for="entry in allRefs"
        :key="`${entry.kind}-${entry.url}`"
        class="imgref-tile ctv-hover-host ctv:relative ctv:w-[76px] ctv:h-[76px] ctv:rounded-sm ctv:overflow-hidden ctv:cursor-pointer
               ctv:bg-black/30 ctv:border"
        :style="{ borderColor: slotColor(entry.m) }"
        :title="refTooltip(entry.kind, entry.m)"
        @click="openRefSlotPicker(entry, $event)"
      >
        <video
          v-if="entry.kind === 'videos'"
          :src="entry.url"
          muted
          playsinline
          preload="metadata"
          class="ctv:block ctv:size-full ctv:object-cover ctv:bg-black ctv:pointer-events-none"
        />
        <div
          v-else-if="entry.kind === 'audio'"
          class="ctv:flex ctv:items-center ctv:justify-center ctv:size-full ctv:text-muted-foreground"
        ><i class="pi pi-volume-up ctv:text-lg" /></div>
        <img
          v-else
          :src="entry.url"
          class="ctv:block ctv:size-full ctv:object-cover"
          draggable="false"
        />
        <span
          class="ctv:absolute ctv:bottom-0 ctv:inset-x-0 ctv:py-0.5 ctv:px-1 ctv:text-3xs ctv:font-semibold
                 ctv:overflow-hidden ctv:whitespace-nowrap ctv:text-ellipsis ctv:pointer-events-none
                 ctv:bg-linear-to-b ctv:from-transparent ctv:to-black/75"
          :style="{ color: slotColor(entry.m) }"
        >{{ entry.kind === 'videos' ? `V${entry.m}` : entry.kind === 'audio' ? `A${entry.m}` : `#${entry.m}` }}</span>
        <button
          type="button"
          class="imgref-remove ctv:absolute ctv:top-0.5 ctv:right-0.5 ctv:flex ctv:items-center ctv:justify-center
                 ctv:size-4 ctv:rounded-sm ctv:cursor-pointer ctv:text-2xs ctv:leading-none ctv:[font-family:inherit]
                 ctv:bg-black/60 ctv:text-white ctv:border ctv:border-white/30 ctv:hover:bg-destructive-background/80"
          :title="$t('imageRefs.remove')"
          @click.stop="onRemoveRef(entry.kind, entry.url)"
        ><i class="pi pi-times" /></button>
        <ViewFullButton
          v-if="entry.kind !== 'videos' && entry.kind !== 'audio'"
          class="ctv:top-0.5 ctv:left-0.5"
          :items="refLightboxItems"
          :index="refLightboxIndex(entry)"
        />
      </div>
    </div>
    <div v-else class="ctv:text-2xs ctv:italic ctv:text-muted-foreground/60">
      {{ $t('imageRefs.empty') }}
    </div>

    <div
      v-if="refWarnings.length"
      class="ctv:flex ctv:flex-col ctv:gap-0.5 ctv:py-1 ctv:px-1.5 ctv:rounded ctv:text-2xs
             ctv:bg-warning-background/10 ctv:border ctv:border-warning-background/40 ctv:text-warning-background"
    >
      <div v-for="(w, i) in refWarnings" :key="i"><i class="pi pi-exclamation-triangle" /> {{ w }}</div>
    </div>

    <MentionSlotPopover
      v-if="refSlotPicker"
      :x="refSlotPicker.x"
      :y="refSlotPicker.y"
      :loading="false"
      :error="null"
      :options="refSlotPicker.options"
      :current-slot="refSlotPicker.current"
      :wired-slots="[]"
      :claimed-slots="[]"
      @pick="onRefSlotPick"
      @close="refSlotPicker = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import AssetPickerPopup from '@/components/stages/AssetPickerPopup.vue'
import MentionSlotPopover from '@/components/stages/MentionSlotPopover.vue'
import ViewFullButton from '@/components/ViewFullButton.vue'
import {
  fetchImageSlotOptionsCached,
  type ImageSlotOption,
} from '@/composables/stages/assetSlots'
import { citedSlots } from '@/composables/stages/directorMentions'
import {
  REF_KINDS,
  refCount,
  type ClipRefEntry,
  type RefKind,
  type SharedUrls,
} from '@/composables/stages/directorRefs'
import { slotColor } from '@/composables/stages/imageSlotMentions'
import { MEDIA_TYPES, readMediaTable } from '@/composables/stages/mediaOrder'
import type { DirectorClip } from '@/composables/stages/useDirectorTimeline'
import { loadWorkflowInfo } from '@/composables/stages/useWorkflowValidator'
import { app, type LGraphNode } from '@/lib/comfyApp'
import { useAssetStore } from '@/stores/assetStore'
import { usePinnedBatchStore } from '@/stores/pinnedBatchStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

const props = defineProps<{
  node: LGraphNode
  clip: DirectorClip
  sharedUrls: SharedUrls
  workflowLabel: string
  onAddRef: (kind: RefKind, url: string) => void
  onRemoveRef: (kind: RefKind, url: string) => void
  onMoveRefTo: (kind: RefKind, from: number, to: number) => void
}>()

const { t } = useI18n()
const assetStore = useAssetStore()
const pinnedStore = usePinnedBatchStore()
const projectStore = useProjectStore()
const selectionStore = useSelectionStore()
const projectId = computed(() => projectStore.currentProjectId || '')

const refsEl = ref<HTMLElement | null>(null)
const pickerOpen = ref(false)

const imageSlotOptions = ref<ImageSlotOption[]>([])
const clipUsage = ref<any>(null)

watchEffect(() => {
  const label = props.workflowLabel
  imageSlotOptions.value = []
  clipUsage.value = null
  if (!label) return
  void fetchImageSlotOptionsCached('video', label)
    .then((opts) => {
      if (props.workflowLabel === label) imageSlotOptions.value = opts
    })
    .catch(() => {})
  void loadWorkflowInfo().then((info) => {
    if (props.workflowLabel === label) {
      clipUsage.value = (info as any)?.video?.[label] ?? null
    }
  })
})

function slotAnnotation(kind: RefKind, i: number): string {
  if (kind !== 'images') return ''
  return imageSlotOptions.value.find(o => o.slot === i - 1)?.nodeTitles.join(', ') ?? ''
}

function refTooltip(kind: RefKind, i: number): string {
  const mention = REF_KINDS.find(k => k.key === kind)!.mention
  const note = slotAnnotation(kind, i)
  return note ? `@${mention}_${i} · ${note}` : `@${mention}_${i}`
}

const sharedCounts = computed<Record<'image' | 'video' | 'audio', number>>(() => {
  void selectionStore.bindingsVersion
  const out = { image: 0, video: 0, audio: 0 }
  const table = readMediaTable(props.node)
  for (const type of MEDIA_TYPES) out[type] = table[type].filter(e => e.src !== 'link').length
  return out
})

const refWarnings = computed<string[]>(() => {
  const clip = props.clip
  const usage = clipUsage.value
  if (!usage) return []
  const cited = {
    image: citedSlots(clip.prompt, 'image'),
    video: citedSlots(clip.prompt, 'video'),
    audio: citedSlots(clip.prompt, 'audio'),
  }
  const manual = cited.image.length + cited.video.length + cited.audio.length > 0
  const out: string[] = []
  for (const k of REF_KINDS) {
    const media = k.media
    const poolCount = clip[k.key].length + sharedCounts.value[media]
    const count = manual
      ? cited[media].filter(slot => slot >= 1 && slot <= poolCount).length
      : poolCount
    if (count === 0) continue
    const max = usage.max_inputs?.[k.info]
    if (usage.uses?.[k.info] === false || max === 0) {
      out.push(t('director.refNotConsumed', {
        kind: t(`director.kind.${k.mention}`),
        workflow: props.workflowLabel,
      }))
    } else if (max != null && count > max) {
      out.push(t('director.refOverLimit', { n: max }))
    }
  }
  return out
})

function openPicker() {
  assetStore.ensureHydrated()
  pickerOpen.value = !pickerOpen.value
}

const batchGroups = computed(() =>
  pinnedStore.list(projectId.value).map(b => ({
    id: b.id, label: b.label, urls: b.urls, canRefresh: !!b.source_uid,
  })),
)

const allRefs = computed<ClipRefEntry[]>(() =>
  REF_KINDS.flatMap(k =>
    props.clip[k.key].map((url, i) => ({
      kind: k.key, url, i,
      m: i + props.sharedUrls[k.key].length + 1,
    }))))

const refLightboxItems = computed(() => allRefs.value
  .filter(e => e.kind !== 'videos' && e.kind !== 'audio')
  .map(e => ({ url: e.url, label: `#${e.m}` })))

function refLightboxIndex(entry: ClipRefEntry): number {
  return Math.max(0, refLightboxItems.value.findIndex(it => it.url === entry.url))
}

const pickerAddedIds = computed<number[]>(() =>
  allRefs.value
    .map(r => assetStore.byPayloadUrl(r.url)?.id)
    .filter((id): id is number => id != null),
)

const pickerAddedBatchKeys = computed<string[]>(() => {
  const out: string[] = []
  for (const g of batchGroups.value) {
    g.urls.forEach((url, i) => {
      if (props.clip.images.includes(url)) out.push(`${g.id}:${i}`)
    })
  }
  return out
})

function onPickAsset(a: { payload_url: string; media_type: string }) {
  const kind = a.media_type === 'video' ? 'videos'
    : a.media_type === 'audio' ? 'audio'
    : 'images'
  props.onAddRef(kind, a.payload_url)
}

function onUnpickAsset(a: { payload_url: string }) {
  const entry = allRefs.value.find(r => r.url === a.payload_url)
  if (entry) props.onRemoveRef(entry.kind, entry.url)
}

function onUnpickBatchImage(groupId: string, index: number) {
  const url = pinnedStore.byId(projectId.value, groupId)?.urls[index]
  if (url && props.clip.images.includes(url)) props.onRemoveRef('images', url)
}

const refSlotPicker = ref<{
  entry: ClipRefEntry
  current: number
  x: number
  y: number
  options: ImageSlotOption[]
} | null>(null)

function openRefSlotPicker(entry: ClipRefEntry, e: MouseEvent) {
  const rootRect = refsEl.value?.getBoundingClientRect()
  if (!rootRect) return
  const tile = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const count = props.clip[entry.kind].length
  const base = props.sharedUrls[entry.kind].length
  refSlotPicker.value = {
    entry,
    current: entry.m,
    x: Math.max(0, Math.min(tile.left - rootRect.left, rootRect.width - 260)),
    y: tile.bottom - rootRect.top + 4,
    options: Array.from({ length: count }, (_, own) => ({
      slot: base + own + 1,
      nodeTitles: entry.kind === 'images'
        ? imageSlotOptions.value.find(o => o.slot === base + own)?.nodeTitles ?? []
        : [],
    })),
  }
}

function onRefSlotPick(slot: number) {
  const picker = refSlotPicker.value
  refSlotPicker.value = null
  if (!picker) return
  const base = props.sharedUrls[picker.entry.kind].length
  props.onMoveRefTo(picker.entry.kind, picker.entry.i, slot - base - 1)
}

function onPickBatchImage(groupId: string, index: number) {
  const url = pinnedStore.byId(projectId.value, groupId)?.urls[index]
  if (url) props.onAddRef('images', url)
}

function onRefreshBatch(id: string) {
  const ok = pinnedStore.refresh(projectId.value, id, app as any)
  if (!ok) {
    ;(app as any)?.extensionManager?.toast?.add?.({
      severity: 'warn',
      summary: t('imageRefs.refreshFailed'),
      life: 4000,
    })
  }
}

function onUnpinBatch(id: string) {
  pinnedStore.unpin(projectId.value, id)
}
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
.imgref-remove {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.imgref-tile:hover .imgref-remove,
.imgref-tile:focus-within .imgref-remove {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none), (pointer: coarse) {
  .imgref-remove {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
