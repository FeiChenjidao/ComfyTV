<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@agent/components/ui/button/Button.vue'
import {
  findOutputAsset,
  findServerPreviewUrl,
  isAssetPreviewSupported
} from '@agent/platform/assets/utils/assetPreviewUtil'
import { useDialogStore } from '@agent/stores/dialogStore'
import { cn } from '@comfyorg/tailwind-utils'

import type { ReplyAsset } from '../../../utils/replyAssets'
import { replyAssetResultItem } from '../../../utils/replyAssets'
import ReplyAudioCard from './ReplyAudioCard.vue'

const { assets } = defineProps<{ assets: ReplyAsset[] }>()

const { t } = useI18n()

/* Three rows of the four-column grid, per DES-530. */
const COLLAPSED_COUNT = 12

const visual = computed(() => assets.filter((asset) => asset.kind !== 'audio'))
const audio = computed(() => assets.filter((asset) => asset.kind === 'audio'))

const expanded = ref(false)
const collapsible = computed(() => visual.value.length > COLLAPSED_COUNT)
const visibleVisual = computed(() =>
  expanded.value || !collapsible.value
    ? visual.value
    : visual.value.slice(0, COLLAPSED_COUNT)
)

const multi = computed(() => visual.value.length > 1)

const AUDIO_COLLAPSED_COUNT = 5

const audioExpanded = ref(false)
const audioCollapsible = computed(
  () => audio.value.length > AUDIO_COLLAPSED_COUNT
)
const visibleAudio = computed(() =>
  audioExpanded.value || !audioCollapsible.value
    ? audio.value
    : audio.value.slice(0, AUDIO_COLLAPSED_COUNT)
)

const gridColsClass = computed(() => {
  const count = visual.value.length
  if (count <= 1) return 'ctv:grid-cols-1'
  if (count === 2) return 'ctv:grid-cols-2'
  if (count === 3) return 'ctv:grid-cols-3'
  return 'ctv:grid-cols-4'
})

const galleryAssets = computed(() =>
  visual.value.filter((asset) => asset.kind !== '3D')
)
const galleryItems = computed(() =>
  galleryAssets.value.map(replyAssetResultItem)
)
const galleryIndex = ref(-1)

const modelThumbnails = ref<Record<string, string>>({})
const assetNames = ref<Record<string, string>>({})

watch(
  () => assets.filter((asset) => asset.kind === '3D' || asset.kind === 'audio'),
  (lookups) => {
    if (!isAssetPreviewSupported()) return
    for (const { url, filename, kind } of lookups) {
      if (kind === '3D' && !(url in modelThumbnails.value)) {
        modelThumbnails.value[url] = ''
        void findServerPreviewUrl(filename)
          .then(async (preview) => {
            if (preview) {
              modelThumbnails.value[url] = preview
              return
            }
            const { generateModelThumbnail } =
              await import('@agent/components/load3d/modelThumbnail')
            const generated = await generateModelThumbnail(url, filename)
            if (generated) modelThumbnails.value[url] = generated
          })
          .catch(() => {})
      }
      if (!(url in assetNames.value)) {
        assetNames.value[url] = ''
        void findOutputAsset(filename)
          .then((record) => {
            if (record?.name) assetNames.value[url] = record.name
          })
          .catch(() => {})
      }
    }
  },
  { immediate: true }
)

const Load3dViewerContent = defineAsyncComponent(
  () => import('@agent/components/load3d/Load3dViewerContent.vue')
)
const MediaLightbox = defineAsyncComponent(
  () => import('@agent/components/sidebar/tabs/queue/MediaLightbox.vue')
)

function refreshModelThumbnail(asset: ReplyAsset, retry = true): void {
  if (!isAssetPreviewSupported() || modelThumbnails.value[asset.url]) return
  void findServerPreviewUrl(asset.filename).then((preview) => {
    if (preview) {
      modelThumbnails.value[asset.url] = preview
    } else if (retry) {
      setTimeout(() => refreshModelThumbnail(asset, false), 2000)
    }
  })
}

function inspect(asset: ReplyAsset): void {
  if (asset.kind === '3D') {
    useDialogStore().showDialog({
      key: 'asset-3d-viewer',
      title: assetNames.value[asset.url] || asset.filename,
      component: Load3dViewerContent,
      props: { modelUrl: asset.url },
      dialogComponentProps: {
        renderer: 'reka',
        size: 'full',
        contentClass: 'ctv:left-1/2 ctv:w-[80vw] ctv:sm:max-w-[80vw] ctv:h-[80vh] ctv:max-h-[80vh]',
        maximizable: true,
        onClose: () => refreshModelThumbnail(asset)
      }
    })
    return
  }
  galleryIndex.value = galleryAssets.value.indexOf(asset)
}

function playPreview(event: Event): void {
  const video = event.target
  if (video instanceof HTMLVideoElement) void video.play().catch(() => {})
}

function stopPreview(event: Event): void {
  const video = event.target
  if (video instanceof HTMLVideoElement) video.pause()
}
</script>

<template>
  <div class="ctv:my-4 ctv:flex ctv:flex-col ctv:gap-2">
    <div v-if="visibleVisual.length" :class="cn('ctv:grid ctv:gap-1', gridColsClass)">
      <button
        v-for="asset in visibleVisual"
        :key="asset.url"
        type="button"
        :aria-label="asset.label ?? asset.filename"
        :class="
          cn(
            'ctv:relative ctv:cursor-pointer ctv:overflow-hidden ctv:rounded-lg ctv:border-none ctv:p-0',
            multi && 'ctv:aspect-square ctv:bg-secondary-background-hover',
            !multi && asset.kind === '3D' && 'ctv:justify-self-end'
          )
        "
        @click="inspect(asset)"
      >
        <img
          v-if="asset.kind === 'image'"
          :src="asset.url"
          :alt="asset.label ?? asset.filename"
          data-testid="reply-image-preview"
          loading="lazy"
          :class="multi ? 'ctv:size-full ctv:object-cover' : 'ctv:block ctv:h-auto ctv:max-w-full'"
        />
        <video
          v-else-if="asset.kind === 'video'"
          :src="asset.url"
          data-testid="reply-video-preview"
          muted
          loop
          playsinline
          preload="metadata"
          :class="multi ? 'ctv:size-full ctv:object-cover' : 'ctv:block ctv:h-auto ctv:max-w-full'"
          @mouseenter="playPreview"
          @mouseleave="stopPreview"
        />
        <img
          v-else-if="modelThumbnails[asset.url]"
          :src="modelThumbnails[asset.url]"
          :alt="asset.label ?? asset.filename"
          loading="lazy"
          :class="multi ? 'ctv:size-full ctv:object-cover' : 'ctv:block ctv:h-auto ctv:max-w-full'"
        />
        <span
          v-else
          :class="
            cn(
              'ctv:flex ctv:items-center ctv:justify-center',
              multi
                ? 'ctv:size-full'
                : 'ctv:aspect-square ctv:w-40 ctv:bg-secondary-background-hover'
            )
          "
        >
          <span class="ctv:icon-[lucide--box] ctv:size-6 ctv:text-muted-foreground" />
        </span>
      </button>
    </div>

    <Button
      v-if="collapsible"
      type="button"
      variant="outline"
      size="sm"
      class="ctv:self-center ctv:rounded-full ctv:border-component-node-border"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('agent.showLess') : t('agent.showMore') }}
      <span
        :class="
          cn('ctv:icon-[lucide--chevron-down] ctv:size-3', expanded && 'ctv:rotate-180')
        "
      />
    </Button>

    <div v-if="audio.length" class="ctv:flex ctv:flex-col ctv:gap-1">
      <ReplyAudioCard
        v-for="asset in visibleAudio"
        :key="asset.url"
        :asset
        :title="assetNames[asset.url] || asset.filename"
      />
      <Button
        v-if="audioCollapsible"
        type="button"
        variant="outline"
        size="sm"
        class="ctv:self-center ctv:rounded-full ctv:border-component-node-border"
        @click="audioExpanded = !audioExpanded"
      >
        {{ audioExpanded ? t('agent.showLess') : t('agent.showMore') }}
        <span
          :class="
            cn(
              'ctv:icon-[lucide--chevron-down] ctv:size-3',
              audioExpanded && 'ctv:rotate-180'
            )
          "
        />
      </Button>
    </div>

    <MediaLightbox
      v-if="galleryIndex !== -1"
      :all-gallery-items="galleryItems"
      :active-index="galleryIndex"
      @update:active-index="galleryIndex = $event"
    />
  </div>
</template>
