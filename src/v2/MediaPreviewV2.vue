<template>
  <div class="v2-mp" :data-kind="kind">
    <template v-if="kind === 'video'">
      <ProxiedVideo
        v-if="resolvedUrl"
        :src="url!"
        :poster="posterUrl"
        class="v2-mp__video"
        controls
        playsinline
        preload="none"
        @pointerdown.stop
      />
    </template>
    <template v-else-if="kind === 'audio'">
      <div v-if="resolvedUrl" class="v2-mp__audiowrap" @pointerdown.stop>
        <svg class="v2-mp__audioicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 8v8" />
        </svg>
        <audio :src="resolvedUrl" controls preload="metadata" class="v2-mp__audio" />
      </div>
    </template>
    <template v-else-if="kind === 'text'">
      <div v-if="text" class="v2-mp__text" @pointerdown.stop @wheel.stop>{{ text }}</div>
    </template>
    <template v-else-if="kind === 'model'">
      <div v-if="url || poolCount > 0" class="v2-mp__model ctv-hover-host" @pointerdown.stop @wheel.stop>
        <ModelPreview v-if="url" ref="modelPreviewEl" :src="url" controls @view-changed="onModelViewChanged" />
        <div
          v-if="url"
          :class="modelActionsClass"
          :data-busy="exporting ? '1' : undefined"
          @pointerdown.stop
        >
          <button
            type="button"
            :class="modelExportBtnClass"
            :disabled="exporting"
            :title="exporting ? t('stage.action.exportObjZipBusy') : t('stage.action.exportObjZip')"
            @click.stop="onDownloadModel"
          >
            <i :class="exporting ? 'pi pi-spin pi-spinner' : 'pi pi-download'" />
          </button>
          <button
            type="button"
            :class="modelTagBtnClass"
            :disabled="exporting"
            :title="t('stage.action.addTag')"
            @click.stop="onTagModel($event)"
          >
            <i class="pi pi-tag" />
          </button>
        </div>
        <div v-if="poolCount > 1" class="v2-mp__hist" @pointerdown.stop>
          <button
            v-for="(_, i) in poolItems"
            :key="i"
            type="button"
            class="v2-mp__histchip"
            :data-current="i + 1 === safePicked ? '1' : undefined"
            :title="t('v2.batchPos', { i: i + 1, n: poolCount })"
            @click.stop="emitPick(i + 1)"
          >{{ i + 1 }}</button>
          <span class="v2-mp__histn">{{ safePicked }}/{{ poolCount }}</span>
        </div>
      </div>
      <Teleport to="body">
        <div
          v-if="tagMenu"
          class="ctv:fixed ctv:inset-0 ctv:z-[9999]"
          @click="closeTagMenu"
          @wheel.prevent.stop
        >
          <div
            class="ctv:absolute ctv:w-44 ctv:max-h-64 ctv:overflow-y-auto ctv:p-1 ctv:rounded ctv:shadow-md ctv:text-xs
                   ctv:bg-interface-menu-surface ctv:border ctv:border-border-default"
            :style="tagMenuStyle"
            @click.stop
          >
            <button type="button" :class="menuItemClass" @click.stop="setUncategorized">
              <span class="ctv:w-3 ctv:inline-block ctv:text-primary-background"><i v-if="tagMenuIsUncategorized()" class="pi pi-check" /></span>
              <span class="ctv:flex-1 ctv:truncate ctv:italic ctv:text-muted-foreground">{{ t('assets.category.none') }}</span>
            </button>
            <div class="ctv:my-1 ctv:border-t ctv:border-border-subtle"></div>
            <button
              v-for="cat in categories"
              :key="cat.id"
              type="button"
              :class="menuItemClass"
              @click.stop="toggleOutputTag(cat.id)"
            >
              <span class="ctv:w-3 ctv:inline-block ctv:text-primary-background"><i v-if="tagMenuHas(cat.id)" class="pi pi-check" /></span>
              <span class="ctv:flex-1 ctv:truncate">{{ cat.name }}</span>
            </button>
            <div v-if="categories.length" class="ctv:my-1 ctv:border-t ctv:border-border-subtle"></div>
            <button type="button" :class="[menuItemClass, 'ctv:text-primary-background']" @click.stop="onCreateCategory">
              <span class="ctv:w-3 ctv:inline-block"><i class="pi pi-plus" /></span>
              <span class="ctv:flex-1 ctv:truncate">{{ t('assets.tagPopover.create') }}</span>
            </button>
          </div>
        </div>
      </Teleport>
    </template>
    <template v-else>
      <ThumbImg v-if="resolvedUrl" class="v2-mp__img" :src="resolvedUrl" :thumb-max="THUMB_PREVIEW" draggable="false" />
      <span v-if="batchCount > 1" class="v2-mp__count">{{ batchCount }}</span>
    </template>
    <div v-if="!hasContent" class="v2-mp__hint">
      <slot name="hint-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M9 9.5l7 3.5-7 3.5z" />
        </svg>
      </slot>
      <span>{{ hint }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ModelPreview from '@/components/stages/ModelPreview.vue'
import ProxiedVideo from '@/components/widgets/ProxiedVideo.vue'
import ThumbImg from '@/components/widgets/ThumbImg.vue'
import { askText } from '@/composables/dialog/useTextInputDialog'
import { useModelViewCapture } from '@/composables/stages/useModelViewCapture'
import { useOutputAssetTagging } from '@/composables/stages/useOutputAssetTagging'
import { app } from '@/lib/comfyApp'
import { downloadModelObjZip } from '@/utils/download'
import { THUMB_CELL, THUMB_PREVIEW, thumbUrl } from '@/utils/thumbUrl'
import { mediaItems, pickedMediaIndex } from '@/v2/mediaItems'

const { t } = useI18n()

const props = defineProps<{
  kind: 'image' | 'video' | 'audio' | 'text' | 'model'
  url?: string | null
  text?: string | null
  hint: string
  onCaptureView?: (url: string) => void
  /** Model history pool JSON `{ images: [{ index, image_url }] }` from the stage widget. */
  poolJson?: string | null
  pickedIndex?: number
  onPickIndex?: (idx: number) => void
}>()

const MODEL_CAPTURE_SIZE = 1024
const MODEL_CAPTURE_DELAY_MS = 250

const modelPreviewEl = ref<InstanceType<typeof ModelPreview> | null>(null)

const {
  tagMenu,
  categories,
  tagMenuStyle,
  nameFromUrl,
  isSaved,
  openTagMenu,
  closeTagMenu,
  tagMenuHas,
  tagMenuIsUncategorized,
  setUncategorized,
  toggleOutputTag,
  createCategoryAndTag,
} = useOutputAssetTagging()

const modelSaved = computed(() => (props.url ? isSaved(props.url) : false))
const exporting = ref(false)

const MODEL_BTN_BASE =
  'ctv:relative ctv:inline-flex ctv:items-center ctv:justify-center ctv:cursor-pointer ctv:appearance-none'
  + ' ctv:border-none ctv:transition-colors ctv:size-5 ctv:p-0 ctv:rounded-sm ctv:text-sm'
  + ' ctv:disabled:opacity-60 ctv:disabled:cursor-wait'
const modelActionsClass =
  'ctv-hover-reveal ctv:absolute ctv:top-1 ctv:right-1 ctv:z-10 ctv:flex ctv:gap-1'
const modelExportBtnClass = MODEL_BTN_BASE + ' ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90'
const modelTagBtnClass = computed(() => MODEL_BTN_BASE
  + (modelSaved.value
    ? ' ctv:bg-primary-background ctv:text-white ctv:hover:bg-primary-background/90'
    : ' ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90'))

function toast(severity: 'info' | 'success' | 'warn' | 'error', summary: string, detail = '') {
  ;(app as any)?.extensionManager?.toast?.add?.({
    severity, summary, detail, life: severity === 'info' ? 12000 : 4000,
  })
}

const { scheduleCapture } = useModelViewCapture({
  getCanvas: () => modelPreviewEl.value?.captureCanvas(MODEL_CAPTURE_SIZE, MODEL_CAPTURE_SIZE),
  filenamePrefix: 'comfytv-model-view',
  logTag: 'MediaPreviewV2',
  delayMs: MODEL_CAPTURE_DELAY_MS,
  onCaptured: (url) => props.onCaptureView?.(url),
})

function onModelViewChanged() {
  if (props.onCaptureView) scheduleCapture()
}

async function onDownloadModel() {
  const url = props.url
  if (!url || exporting.value) return
  exporting.value = true
  toast('info', t('stage.action.exportObjZipBusy'))
  try {
    await downloadModelObjZip(url)
    toast('success', t('stage.action.exportObjZipDone'))
  } catch (e: any) {
    console.error('[ComfyTV/model-preview] OBJ zip export failed', e)
    toast('error', t('stage.action.exportObjZipFailed'), String(e?.message || e))
  } finally {
    exporting.value = false
  }
}

function onTagModel(e: MouseEvent) {
  const url = props.url
  if (!url) return
  openTagMenu(url, nameFromUrl(url), e, 'model')
}

async function onCreateCategory() {
  const name = (await askText({
    title: t('assets.category.new'),
    label: t('assets.category.newPrompt'),
  }))?.trim()
  if (!name) return
  await createCategoryAndTag(name)
}

const menuItemClass = 'ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:px-1.5 ctv:py-1 ctv:rounded-sm ctv:cursor-pointer '
  + 'ctv:text-left ctv:text-2xs ctv:bg-transparent ctv:border-none ctv:text-base-foreground '
  + 'ctv:hover:bg-secondary-background-hover'

const batchImages = computed<string[]>(() => {
  if (props.kind !== 'image') return []
  const u = String(props.url ?? '')
  if (!u.trimStart().startsWith('{')) return []
  try {
    const parsed = JSON.parse(u)
    const items = Array.isArray(parsed?.images) ? parsed.images : []
    return items.map((x: any) => String(x?.image_url ?? '')).filter(Boolean)
  } catch {
    return []
  }
})

const batchCount = computed(() => batchImages.value.length)

const resolvedUrl = computed(() => {
  const u = batchImages.value[0] ?? String(props.url ?? '')
  if (!u || u.trimStart().startsWith('{')) return ''
  return (app as any).api.apiURL(u.replace(/^\/api/, ''))
})

const posterUrl = computed(() => {
  if (props.kind !== 'video' || !resolvedUrl.value) return undefined
  const raw = String(props.url ?? '').replace(/^\/api/, '')
  const t = thumbUrl(raw, THUMB_CELL)
  return t === raw ? undefined : t
})

const poolItems = computed(() =>
  props.kind === 'model'
    ? mediaItems({ output: null, pool: props.poolJson ?? null }, 'pool')
    : [])
const poolCount = computed(() => poolItems.value.length)
const safePicked = computed(() => pickedMediaIndex({ pickedIndex: props.pickedIndex }, poolCount.value))

function emitPick(idx: number) {
  props.onPickIndex?.(idx)
}

const hasContent = computed(() =>
  props.kind === 'text' ? !!String(props.text ?? '').trim()
  : props.kind === 'model' ? !!(props.url || poolCount.value)
  : !!resolvedUrl.value)
</script>

<style scoped>
.v2-mp {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  overflow: hidden;
  background: var(--v2-media-bg);
  border: 1px solid var(--v2-media-border);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.v2-mp[data-kind="image"] {
  background: var(--v2-checker);
  background-size: 18px 18px;
}
.v2-mp__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.v2-mp__video,
.v2-mp :deep(video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.v2-mp__audiowrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  width: 100%;
  padding: 0 16px;
  box-sizing: border-box;
}
.v2-mp__audioicon {
  width: 40px;
  height: 40px;
  color: var(--v2-text-muted);
}
.v2-mp__audio {
  width: 100%;
  max-width: 340px;
  height: 34px;
}
.v2-mp__model {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  color: var(--v2-text-faint);
  cursor: grab;
}
.v2-mp__model:active { cursor: grabbing; }
.v2-mp__model :deep(> *:not(.ctv-hover-reveal)) {
  flex: 1;
  min-height: 0;
  width: 100%;
}
/* Keep export/tag visible while OBJ zip is running. */
.v2-mp__model .ctv-hover-reveal[data-busy='1'] {
  opacity: 1;
  pointer-events: auto;
}
.v2-mp__text {
  position: absolute;
  inset: 0;
  padding: 12px 14px;
  overflow-y: auto;
  color: var(--v2-text-mid);
  font: 400 12px/1.7 system-ui, sans-serif;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
  cursor: text;
  user-select: text;
}
.v2-mp__hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--v2-text-faint);
  font: 500 12px/1.5 system-ui, sans-serif;
}
.v2-mp__hint svg { width: 26px; height: 26px; opacity: 0.55; }
.v2-mp__count {
  position: absolute;
  right: 8px;
  top: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(23, 23, 27, 0.75);
  color: #cdbdfc;
  font: 600 10px/1 system-ui, sans-serif;
}
.v2-mp__hist {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 8px;
  background: rgba(23, 23, 27, 0.78);
  pointer-events: auto;
}
.v2-mp__histchip {
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: transparent;
  color: #d4d4d8;
  font: 600 10px/1 system-ui, sans-serif;
  cursor: pointer;
}
.v2-mp__histchip:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.v2-mp__histchip[data-current='1'] {
  background: rgba(139, 92, 246, 0.35);
  border-color: rgba(167, 139, 250, 0.7);
  color: #ede9fe;
}
.v2-mp__histn {
  margin-left: auto;
  color: #a1a1aa;
  font: 600 10px/1 system-ui, sans-serif;
}
</style>
