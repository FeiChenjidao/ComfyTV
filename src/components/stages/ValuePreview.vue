<template>
  <div :class="rootClass">
    <span v-if="!compact" :class="typeBadgeClass">{{ shortType }}</span>

    <div v-if="!hasContent" :class="emptyClass">{{ emptyLabel }}</div>

    <pre v-else-if="type === 'COMFYTV_TEXT' && compact" :class="textClass">{{ content }}</pre>

    <div v-else-if="type === 'COMFYTV_TEXT'" class="vp-img-host ctv:group ctv:relative ctv:flex-1 ctv:min-h-[160px]">
      <pre @wheel.stop class="vp-text-scroll ctv:absolute ctv:inset-0 ctv:m-0 ctv:py-0.5 ctv:px-1 ctv:overflow-y-auto
                  ctv:whitespace-pre-wrap ctv:break-words ctv:text-[11px] ctv:leading-snug ctv:font-mono ctv:text-base-foreground
                  ctv:select-text ctv:cursor-text"
           @pointerdown.stop
           @pointermove.stop
           @pointerup.stop>{{ content }}</pre>
      <div :class="imgActionsClass">
        <button type="button" :class="imgActionBtn"
                :title="$t('stage.action.copyText')"
                @click.stop="onCopyText"><i :class="textCopied ? 'pi pi-check' : 'pi pi-copy'" /></button>
        <button type="button" :class="imgActionBtn"
                :title="$t('stage.action.saveTextAsset')"
                :disabled="textSaving"
                @click.stop="onSaveTextAsset"><i :class="textSaved ? 'pi pi-check' : 'pi pi-tag'" /></button>
        <button type="button" :class="imgActionBtn"
                :title="$t('stage.action.download')"
                @click.stop="onDownloadText"><i class="pi pi-download" /></button>
      </div>
    </div>

    <div
      v-else-if="(type === 'COMFYTV_IMAGE' || type === 'COMFYTV_PANORAMA') && !compact"
      ref="zoomContainer"
      class="vp-img-host ctv:group ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-0 ctv:overflow-hidden ctv:rounded-sm ctv:touch-none ctv:cursor-grab"
    >
      <img
        ref="zoomImg"
        :src="mainImgSrc"
        class="ctv:block ctv:size-full ctv:object-contain ctv:select-none"
        :alt="String(content)"
        draggable="false"
        @error="onMainImgError"
      />
      <div :class="imgActionsClass">
        <MediaActionBar
          :url="String(content)"
          :label="nameFromUrl(String(content))"
          :media-type="previewMediaType"
          :saved="isSaved(String(content))"
          show-view
          @view="openViewer(String(content))"
          @download="onDownload"
          @tag="onTagFromBar"
          @load-asset="onLoadAssetFromBar"
        />
      </div>
    </div>
    <ThumbImg
      v-else-if="type === 'COMFYTV_IMAGE' || type === 'COMFYTV_PANORAMA'"
      :src="String(content)"
      :thumb-max="THUMB_CELL"
      :class="imgClass"
      :alt="String(content)"
    />

    <div
      v-else-if="type === 'COMFYTV_VIDEO' && !compact"
      class="vp-img-host ctv:group ctv:relative ctv:w-full"
    >
      <ProxiedVideo
        :src="String(content)"
        :class="videoClass"
        controls muted playsinline preload="metadata"
      />
      <div :class="imgActionsClass">
        <MediaActionBar
          :url="String(content)"
          :label="nameFromUrl(String(content))"
          :media-type="previewMediaType"
          :saved="isSaved(String(content))"
          @download="onDownload"
          @tag="onTagFromBar"
          @load-asset="onLoadAssetFromBar"
        />
      </div>
    </div>
    <div v-else-if="type === 'COMFYTV_VIDEO'" class="ctv:relative ctv:size-full">
      <ThumbImg
        :src="String(content)"
        :thumb-max="THUMB_CELL"
        :class="imgClass"
        :alt="String(content)"
      />
      <i class="pi pi-play-circle ctv:absolute ctv:bottom-1 ctv:right-1 ctv:text-sm ctv:text-white/80 ctv:pointer-events-none ctv:drop-shadow" />
    </div>

    <template v-else-if="type === 'COMFYTV_AUDIO'">
      <div v-if="compact" :class="compactSummary">
        <span class="ctv:text-[22px] ctv:leading-none"><i class="pi pi-volume-up" /></span>
      </div>
      <div
        v-else
        class="vp-img-host ctv:group ctv:relative ctv:w-full"
      >
        <audio
          :src="String(content)"
          class="ctv:block ctv:w-full ctv:mt-3.5"
          controls preload="metadata"
        />
        <div :class="imgActionsClass">
          <MediaActionBar
            :url="String(content)"
            :label="nameFromUrl(String(content))"
            :media-type="previewMediaType"
            :saved="isSaved(String(content))"
            @download="onDownload"
            @tag="onTagFromBar"
            @load-asset="onLoadAssetFromBar"
          />
        </div>
      </div>
    </template>

    <template v-else-if="type === 'COMFYTV_MODEL'">
      <div v-if="compact" class="ctv:size-full">
        <ModelThumb :src="String(content)">
          <i class="pi pi-box ctv:text-[22px]" />
        </ModelThumb>
      </div>
      <div
        v-else
        class="vp-img-host ctv:group ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-[220px] ctv:overflow-hidden ctv:rounded-sm"
      >
        <ModelPreview
          ref="modelPreviewEl"
          :src="String(content)"
          @view-changed="scheduleModelCapture"
        />
        <div :class="imgActionsClass">
          <MediaActionBar
            :url="String(content)"
            :label="nameFromUrl(String(content))"
            :media-type="previewMediaType"
            :saved="isSaved(String(content))"
            @download="onDownload"
            @tag="onTagFromBar"
            @load-asset="onLoadAssetFromBar"
          />
        </div>
      </div>
    </template>

    <template v-else-if="type === 'COMFYTV_MATERIAL'">
      <div v-if="compact" class="ctv:flex ctv:items-center ctv:justify-center ctv:size-full">
        <span class="ctv:size-10 ctv:rounded-full" :style="materialSwatchStyle" />
      </div>
      <div v-else class="ctv:flex ctv:items-center ctv:gap-2.5 ctv:pt-3.5 ctv:pb-1 ctv:px-1">
        <span class="ctv:size-16 ctv:shrink-0 ctv:rounded-full" :style="materialSwatchStyle" />
        <div class="ctv:flex ctv:flex-col ctv:gap-0.5 ctv:min-w-0 ctv:text-2xs ctv:font-mono ctv:text-muted-foreground">
          <span class="ctv:text-base-foreground">{{ materialParams.color }}</span>
          <span>M {{ materialParams.metalness.toFixed(2) }} · R {{ materialParams.roughness.toFixed(2) }}</span>
          <span>T {{ materialParams.transmission.toFixed(2) }} · A {{ materialParams.opacity.toFixed(2) }}</span>
        </div>
      </div>
    </template>

    <template v-else-if="type === 'COMFYTV_FXSPEC'">
      <div v-if="compact" :class="compactSummary">
        <span class="ctv:text-[22px] ctv:leading-none ctv:text-[#b8c4ff]"><i class="pi pi-bolt" /></span>
        <span class="ctv:max-w-full ctv:px-1 ctv:truncate ctv:text-3xs ctv:font-bold ctv:text-[#b8c4ff]">
          {{ fxSpecInfo ? fxSpecInfo.label : '…' }}
        </span>
      </div>
      <div v-else class="ctv:flex ctv:items-center ctv:gap-2 ctv:pt-3.5 ctv:pb-1 ctv:px-1">
        <span class="ctv:shrink-0 ctv:flex ctv:items-center ctv:justify-center ctv:size-8 ctv:rounded-sm
                     ctv:bg-[rgb(120_140_255/0.18)] ctv:text-[#b8c4ff]"><i class="pi pi-bolt" /></span>
        <div class="ctv:flex ctv:flex-col ctv:gap-0.5 ctv:min-w-0">
          <span class="ctv:truncate ctv:text-[11px] ctv:font-semibold ctv:text-base-foreground">
            {{ fxSpecInfo ? fxSpecInfo.label : $t('fxChain.unknown') }}
          </span>
          <span v-if="fxSpecInfo && fxSpecInfo.count > 1" class="ctv:text-3xs ctv:font-mono ctv:text-muted-foreground">
            ×{{ fxSpecInfo.count }}
          </span>
        </div>
      </div>
    </template>

    <ValuePreviewShotList
      v-else-if="isShotListType"
      :type="type"
      :compact="compact"
      :shots="storyboardShots"
      :segments="timelineSegs"
      :total-sec="storyboardTotalSec"
    />

    <ValuePreviewBatch
      v-else-if="isBatchType"
      :type="type"
      :items="batchImages"
      :media-type="previewMediaType"
      :compact="compact"
      :empty-label="emptyLabel"
      :selected-index="selectedIndex"
      :click-mode="clickMode"
      :removable="removable"
      :upstream-urls="upstreamUrls"
      :name-from-url="nameFromUrl"
      :is-saved="isSaved"
      :on-download="onDownload"
      :on-tag="onTagFromBar"
      :on-load-asset="onLoadAssetFromBar"
      @item-click="emit('item-click', $event)"
      @item-remove="emit('item-remove', $event)"
    />

    <div v-else :class="emptyClass">{{ $t('stage.empty.unsupported_type', { type }) }}</div>

    <OutputTagMenu :tagging="tagging" />
  </div>
</template>


<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import ModelPreview from './ModelPreview.vue'
import MediaActionBar from './MediaActionBar.vue'
import OutputTagMenu from './OutputTagMenu.vue'
import ValuePreviewBatch from './ValuePreviewBatch.vue'
import ValuePreviewShotList from './ValuePreviewShotList.vue'
import ModelThumb from '@/components/widgets/ModelThumb.vue'
import ProxiedVideo from '@/components/widgets/ProxiedVideo.vue'
import ThumbImg from '@/components/widgets/ThumbImg.vue'
import { useImagePanZoom } from '@/composables/widgets/useImagePanZoom'
import { openLightbox } from '@/composables/useLightbox'
import { useModelViewCapture } from '@/composables/stages/useModelViewCapture'
import { useOutputAssetTagging } from '@/composables/stages/useOutputAssetTagging'
import { useTextOutputActions } from '@/composables/stages/useTextOutputActions'
import {
  materialSwatchStyleOf,
  previewMediaTypeOf,
  useValuePreview,
} from '@/composables/stages/useValuePreview'
import { parseFxSpec } from '@/composables/stages/useFxChain'
import { parseMaterialState } from '@/widgets/material/types'
import type { ItemClickPayload } from '@/types/payloads'
import { downloadFile } from '@/utils/download'
import { THUMB_CELL, THUMB_PREVIEW, thumbUrl } from '@/utils/thumbUrl'

import {
  compactSummary,
  emptyClass as emptyClassOf,
  imgActionBtn,
  imgActionsClass,
  imgClass as imgClassOf,
  rootClass as rootClassOf,
  textClass,
  typeBadgeClass as typeBadgeClassOf,
  videoClass as videoClassOf,
} from './valuePreviewClasses'

const tagging = useOutputAssetTagging()
const { tagMenu, nameFromUrl, isSaved, openTagMenu, closeTagMenu } = tagging

const zoomContainer = ref<HTMLElement | null>(null)
const zoomImg = ref<HTMLImageElement | null>(null)

const MODEL_CAPTURE_SIZE = 1024
const MODEL_CAPTURE_DELAY_MS = 250

const modelPreviewEl = ref<InstanceType<typeof ModelPreview> | null>(null)

const { scheduleCapture: scheduleModelCapture, cancelCapture: cancelModelCapture } = useModelViewCapture({
  getCanvas: () => modelPreviewEl.value?.captureCanvas(MODEL_CAPTURE_SIZE, MODEL_CAPTURE_SIZE),
  filenamePrefix: 'comfytv-model-view',
  logTag: 'ModelPreview',
  delayMs: MODEL_CAPTURE_DELAY_MS,
  onCaptured: (url) => emit('capture-view', { index: '', imageUrl: url, mediaType: 'image' }),
})

function openViewer(url: string) {
  if (url) openLightbox([{ url }], 0)
}

async function onDownload(url: string) {
  if (!url) return
  try {
    await downloadFile(url)
  } catch (err) {
    console.error('[ComfyTV/download] failed', err)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (tagMenu.value) closeTagMenu()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  cancelModelCapture()
})

const props = defineProps<{
  type:
    | 'COMFYTV_TEXT'
    | 'COMFYTV_IMAGE'
    | 'COMFYTV_VIDEO'
    | 'COMFYTV_PANORAMA'
    | 'COMFYTV_STORYBOARD'
    | 'COMFYTV_IMAGES'
    | string
  content?: string | null
  emptyLabel?: string
  selectedIndex?: string | number
  clickMode?: 'refine' | 'pick'
  compact?: boolean
  removable?: boolean
  upstreamUrls?: string[]
}>()

useImagePanZoom(zoomContainer, zoomImg, { resetKey: toRef(props, 'content') })

const mainThumbFailed = ref(false)
watch(() => props.content, () => { mainThumbFailed.value = false })
const mainImgSrc = computed(() => {
  const src = String(props.content ?? '')
  return mainThumbFailed.value ? src : thumbUrl(src, THUMB_PREVIEW)
})
function onMainImgError() {
  if (!mainThumbFailed.value && mainImgSrc.value !== String(props.content ?? '')) {
    mainThumbFailed.value = true
  }
}

const {
  hasContent,
  shortType,
  batchImages,
  storyboardShots,
  timelineSegs,
  storyboardTotalSec,
} = useValuePreview(() => props.type, () => props.content)

const emit = defineEmits<{
  (e: 'item-click', payload: ItemClickPayload): void
  (e: 'item-remove', payload: ItemClickPayload): void
  (e: 'load-asset', payload: ItemClickPayload): void
  (e: 'capture-view', payload: ItemClickPayload): void
}>()

const isBatchType = computed(() =>
  props.type === 'COMFYTV_IMAGES' || props.type === 'COMFYTV_AUDIOS' || props.type === 'COMFYTV_VIDEOS')
const isShotListType = computed(() =>
  props.type === 'COMFYTV_STORYBOARD' || props.type === 'COMFYTV_TIMELINE')

const materialParams = computed(() => parseMaterialState(props.content))

const fxSpecInfo = computed(() =>
  props.type === 'COMFYTV_FXSPEC' ? parseFxSpec(props.content) : null)

const materialSwatchStyle = computed(() => materialSwatchStyleOf(materialParams.value))

const previewMediaType = computed<string>(() => previewMediaTypeOf(props.type))

function onLoadAsset(url: string, label: string) {
  if (!url) return
  emit('load-asset', { index: '', imageUrl: url, label, mediaType: previewMediaType.value })
}

function onTagFromBar(p: { url: string; label: string; mediaType: string; event: MouseEvent }) {
  openTagMenu(p.url, p.label, p.event, p.mediaType)
}

function onLoadAssetFromBar(p: { url: string; label: string }) {
  onLoadAsset(p.url, p.label)
}

const {
  textCopied,
  textSaved,
  textSaving,
  copyText: onCopyText,
  downloadText: onDownloadText,
  saveTextAsset: onSaveTextAsset,
} = useTextOutputActions(() => String(props.content ?? ''))

const rootClass = computed(() => rootClassOf(!!props.compact))
const typeBadgeClass = computed(() => typeBadgeClassOf(props.type))
const emptyClass = computed(() => emptyClassOf(!!props.compact))
const imgClass = computed(() => imgClassOf(!!props.compact))
const videoHasAlpha = computed(() =>
  String(props.content ?? '').split('?')[0].toLowerCase().endsWith('.webm'))
const videoClass = computed(() => videoClassOf(!!props.compact, videoHasAlpha.value))
</script>

<style scoped>
.ctv-checker {
  background-image:
    linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%),
    linear-gradient(45deg, #333 25%, #222 25%, #222 75%, #333 75%);
  background-size: 16px 16px;
  background-position: 0 0, 8px 8px;
}

.vp-text-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
}
.vp-text-scroll::-webkit-scrollbar {
  width: 10px;
}
.vp-text-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.vp-text-scroll::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.35);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: content-box;
}
.vp-text-scroll:hover::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.55);
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
