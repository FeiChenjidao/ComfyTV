<template>
  <template v-if="type === 'COMFYTV_IMAGES'">
    <template v-if="compact">
      <ThumbImg
        v-if="items[0]"
        :src="items[0].image_url"
        :thumb-max="THUMB_CELL"
        :class="imgClass(true)"
        :alt="`${items.length} items`"
      />
      <div v-else :class="emptyClass(true)">{{ emptyLabel || '…' }}</div>
      <span v-if="items.length > 0"
            class="ctv:absolute ctv:top-0.5 ctv:left-0.5 ctv:pointer-events-none ctv:py-px ctv:px-[5px]
                   ctv:text-3xs ctv:font-bold ctv:tracking-wide ctv:rounded-lg
                   ctv:bg-[rgb(255_140_200/0.85)] ctv:text-white">
        {{ items.length }}
      </span>
    </template>
    <div v-else class="ctv-batch-grid">
      <div
        v-for="(img, i) in items"
        :key="i"
        :class="batchCellClass(isItemSelected(img, i), pick)"
        :title="cellTooltip(img, i)"
        :role="pick ? 'button' : undefined"
        :tabindex="pick ? 0 : undefined"
        @click="pick ? onItemClick(img, i) : undefined"
        @keydown="pick ? onCellKey(img, i, $event) : undefined"
      >
        <ThumbImg :src="img.image_url" :thumb-max="THUMB_CELL"
                  :alt="img.label || img.prompt || `item ${i + 1}`"
                  class="ctv:block ctv:size-full ctv:object-cover ctv:pointer-events-none" />
        <span class="ctv:absolute ctv:bottom-0.5 ctv:left-0.5 ctv:py-px ctv:px-1 ctv:text-3xs ctv:font-bold ctv:rounded-sm
                     ctv:bg-black/70 ctv:text-[#ffb0d8]">
          {{ img.label ?? `#${img.index ?? i + 1}` }}
        </span>
        <span v-if="removable && isUpstreamItem(img)"
              class="ctv:absolute ctv:bottom-0.5 ctv:right-0.5 ctv:py-px ctv:px-1 ctv:text-3xs ctv:font-bold ctv:rounded-sm
                     ctv:bg-primary-background/85 ctv:text-white"
              :title="$t('valuePreview.fromUpstream')"><i class="pi pi-arrow-up" /></span>
        <span v-if="pick && isItemSelected(img, i)"
              class="ctv:absolute ctv:top-0.5 ctv:right-0.5 ctv:flex ctv:items-center ctv:justify-center
                     ctv:size-4 ctv:rounded-full ctv:text-3xs ctv:leading-none
                     ctv:bg-primary-background ctv:text-white ctv:shadow-[0_1px_3px_rgb(0_0_0/0.5)]"><i class="pi pi-check" /></span>
        <span v-else-if="pick"
              class="ctv:absolute ctv:top-0.5 ctv:right-0.5 ctv:py-px ctv:px-1 ctv:text-2xs ctv:rounded-sm
                     ctv:bg-black/55 ctv:opacity-0 ctv:transition-opacity ctv:duration-150 ctv:group-hover:opacity-100">
          <i :class="clickHintIcon" />
        </span>
        <div :class="imgActionsClass">
          <MediaActionBar
            :url="img.image_url"
            :label="img.label || img.prompt || nameFromUrl(img.image_url)"
            :media-type="mediaType"
            :saved="isSaved(img.image_url)"
            show-view
            :show-remove="canRemoveItem(img, i)"
            @view="openBatchViewer(i)"
            @download="onDownload"
            @tag="onTag"
            @load-asset="onLoadAsset"
            @remove="onItemRemove(img, i)"
          />
        </div>
      </div>
    </div>
  </template>

  <template v-else>
    <div v-if="compact" :class="compactSummary">
      <span class="ctv:text-[22px] ctv:leading-none"><i :class="type === 'COMFYTV_VIDEOS' ? 'pi pi-video' : 'pi pi-volume-up'" /></span>
      <span v-if="items.length" class="vp-compact-count-text ctv:text-sm ctv:font-bold ctv:text-[#d8b0ff]">{{ items.length }}</span>
    </div>
    <div v-else class="ctv:flex ctv:flex-col ctv:gap-1">
      <div v-if="items.length === 0" :class="emptyClass(false)">{{ emptyLabel || '…' }}</div>
      <div
        v-for="(track, i) in items"
        :key="i"
        :class="audioRowClass(isItemSelected(track, i), pick)"
        :title="cellTooltip(track, i)"
      >
        <div
          class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:min-w-0"
          :class="pick ? 'ctv:cursor-pointer' : undefined"
          :role="pick ? 'button' : undefined"
          :tabindex="pick ? 0 : undefined"
          @click="pick ? onItemClick(track, i) : undefined"
          @keydown="pick ? onCellKey(track, i, $event) : undefined"
        >
          <span v-if="pick && isItemSelected(track, i)"
                class="ctv:shrink-0 ctv:flex ctv:items-center ctv:justify-center ctv:size-4 ctv:rounded-full
                       ctv:text-3xs ctv:leading-none ctv:bg-primary-background ctv:text-white
                       ctv:shadow-[0_1px_3px_rgb(0_0_0/0.5)]"><i class="pi pi-check" /></span>
          <span v-if="removable && isUpstreamItem(track)"
                class="ctv:shrink-0 ctv:flex ctv:items-center ctv:py-px ctv:px-1 ctv:text-3xs ctv:font-bold
                       ctv:rounded-sm ctv:bg-primary-background/85 ctv:text-white"
                :title="$t('valuePreview.fromUpstream')"><i class="pi pi-arrow-up" /></span>
          <span class="ctv:min-w-0 ctv:flex-1 ctv:truncate ctv:text-3xs ctv:font-bold ctv:text-[#ffb0d8]">
            {{ track.label ?? `#${track.index ?? i + 1}` }}
          </span>
        </div>
        <ProxiedVideo
          v-if="type === 'COMFYTV_VIDEOS'"
          :src="track.image_url" class="ctv:block ctv:w-full ctv:max-h-32 ctv:rounded-sm ctv:bg-black"
          controls muted playsinline preload="metadata"
          @click.stop />
        <audio v-else :src="track.image_url" class="ctv:block ctv:w-full ctv:h-8" controls preload="metadata"
               @click.stop />
        <div :class="imgActionsClass">
          <MediaActionBar
            :url="track.image_url"
            :label="track.label || track.prompt || nameFromUrl(track.image_url)"
            :media-type="mediaType"
            :saved="isSaved(track.image_url)"
            :show-remove="canRemoveItem(track, i)"
            @download="onDownload"
            @tag="onTag"
            @load-asset="onLoadAsset"
            @remove="onItemRemove(track, i)"
          />
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import MediaActionBar from './MediaActionBar.vue'
import ProxiedVideo from '@/components/widgets/ProxiedVideo.vue'
import ThumbImg from '@/components/widgets/ThumbImg.vue'
import { openLightbox } from '@/composables/useLightbox'
import {
  batchItemPayload,
  batchItemTag,
  batchLightboxItems,
  canRemoveBatchItem,
  isActivationKey,
  isBatchItemSelected,
  isUpstreamBatchItem,
} from '@/composables/stages/useValuePreview'
import type { BatchImage, ItemClickPayload } from '@/types/payloads'
import { THUMB_CELL } from '@/utils/thumbUrl'

import {
  audioRowClass,
  batchCellClass,
  compactSummary,
  emptyClass,
  imgActionsClass,
  imgClass,
} from './valuePreviewClasses'

const props = defineProps<{
  type: string
  items: BatchImage[]
  mediaType: string
  compact?: boolean
  emptyLabel?: string
  selectedIndex?: string | number
  clickMode?: 'refine' | 'pick'
  removable?: boolean
  upstreamUrls?: string[]
  nameFromUrl: (url: string) => string
  isSaved: (url: string) => boolean
  onDownload: (url: string) => void
  onTag: (p: { url: string; label: string; mediaType: string; event: MouseEvent }) => void
  onLoadAsset: (p: { url: string; label: string }) => void
}>()

const emit = defineEmits<{
  (e: 'item-click', payload: ItemClickPayload): void
  (e: 'item-remove', payload: ItemClickPayload): void
}>()

const { t } = useI18n()

const pick = computed(() => props.clickMode === 'pick')
const clickHintIcon = computed(() => pick.value ? 'pi pi-check' : 'pi pi-pencil')

function openBatchViewer(i: number) {
  openLightbox(batchLightboxItems(props.items, props.nameFromUrl), i)
}

function onItemClick(img: BatchImage, i: number) {
  emit('item-click', batchItemPayload(img, i))
}

function onItemRemove(img: BatchImage, i: number) {
  emit('item-remove', batchItemPayload(img, i))
}

function onCellKey(img: BatchImage, i: number, e: KeyboardEvent) {
  if (isActivationKey(e.key)) {
    e.preventDefault()
    onItemClick(img, i)
  }
}

function isItemSelected(img: BatchImage, i: number): boolean {
  return isBatchItemSelected(img, i, props.selectedIndex)
}

function isUpstreamItem(img: BatchImage): boolean {
  return isUpstreamBatchItem(img, props.upstreamUrls)
}

function canRemoveItem(img: BatchImage, i: number): boolean {
  return canRemoveBatchItem(img, i, {
    removable: props.removable,
    selectedIndex: props.selectedIndex,
    upstreamUrls: props.upstreamUrls,
  })
}

function cellTooltip(img: BatchImage, i: number): string {
  const tag = batchItemTag(img, i)
  return pick.value ? t('shotCell.pick', { tag }) : t('shotCell.refine', { tag })
}
</script>

<style scoped>
.ctv-batch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 4px;
  padding-top: 14px;
  max-height: 320px;
  overflow: auto;
}

.vp-img-actions {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.vp-img-host:hover .vp-img-actions,
.vp-img-host:focus-within .vp-img-actions {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none), (pointer: coarse) {
  .vp-img-actions {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
