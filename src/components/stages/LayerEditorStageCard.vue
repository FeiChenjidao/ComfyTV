<template>
  <div
    v-if="isCanvasStage && !fullscreen"
    data-testid="canvas-output-preview"
    class="ctv:group ctv:relative ctv:size-full ctv:min-h-[260px] ctv:overflow-hidden ctv:rounded-md ctv:border ctv:border-border-subtle ctv:bg-black ctv:cursor-zoom-in ctv:select-none"
    role="button"
    tabindex="0"
    :title="$t('canvas.openHint')"
    @pointerdown.stop
    @mousedown.stop
    @contextmenu.stop.prevent
    @dblclick.stop.prevent="openCanvas"
    @keydown.enter.stop.prevent="openCanvas"
  >
    <img
      v-if="previewUrl"
      :src="previewUrl"
      class="ctv:block ctv:size-full ctv:object-contain ctv:pointer-events-none"
      draggable="false"
      alt="Canvas output"
    />
    <div
      v-else
      class="ctv:absolute ctv:inset-0 ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:gap-2 ctv:text-muted-foreground"
    >
      <i class="pi pi-image ctv:text-3xl ctv:opacity-60" />
      <span class="ctv:text-xs">{{ $t('canvas.emptyHint') }}</span>
    </div>
    <div
      class="ctv:absolute ctv:inset-x-0 ctv:bottom-0 ctv:bg-black/65 ctv:px-2 ctv:py-1 ctv:text-center ctv:text-2xs ctv:text-white/80 ctv:opacity-0 ctv:transition-opacity ctv:group-hover:opacity-100"
    >
      {{ $t('canvas.openHint') }}
    </div>
  </div>

  <Teleport v-else to="body" :disabled="!fullscreen">
    <div
      class="ctv:flex ctv:flex-col ctv:gap-1 ctv:text-xs ctv:text-base-foreground ctv:outline-none"
      :class="fullscreen
        ? 'comfytv-fs ctv:fixed ctv:inset-0 ctv:z-[1400] ctv:bg-base-background ctv:p-2'
        : 'ctv:size-full ctv:min-h-0'"
      tabindex="0"
      @pointerdown.stop
      @mousedown.stop
      @contextmenu.stop.prevent
      @keydown="onKeyDown"
      @keyup="onKeyUp"
    >
      <LayerEditorToolBar :editor="editor">
        <template #trailing>
          <button
            type="button"
            :class="iconToolBtnClass"
            :title="$t(fullscreen ? 'pentrado.exitFullscreen' : 'pentrado.fullscreen')"
            @click="toggleFullscreen"
          >
            <IconMinimize v-if="fullscreen" class="ctv:size-4" />
            <IconMaximize v-else class="ctv:size-4" />
          </button>
        </template>
      </LayerEditorToolBar>

      <div class="ctv:flex ctv:min-h-0 ctv:flex-1 ctv:gap-1">
        <LayerEditorToolStrip :editor="editor" />
        <div class="ctv:relative ctv:min-w-0 ctv:flex-1">
          <LayerEditorCanvas ref="canvasEl" :editor="editor" />
          <TextEditPopup :editor="editor" />
        </div>
        <LayerListPanel :editor="editor" />
      </div>

      <StageCard
        class="ctv:h-auto! ctv:grow-0 ctv:shrink-0"
        :state="stageState"
        :node="node"
        :on-run-request="onRunRequest"
        :on-cancel-request="onCancelRequest"
        :on-disconnect="onDisconnect"
        :on-action="onAction"
        hide-context
        hide-output
        hide-actions
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IconMaximize from '~icons/lucide/maximize-2'
import IconMinimize from '~icons/lucide/minimize-2'

import {
  LayerEditorCanvas,
  LayerEditorToolBar,
  LayerEditorToolStrip,
  LayerListPanel,
  TextEditPopup,
  createLayerEditorOps,
  useLayerEditorHotkeys,
} from '@jtydhr88/pentrado'

import type { LGraphNode } from '@/lib/comfyApp'
import StageCard from '@/components/stages/StageCard.vue'
import { pickSourceImageUrl } from '@/composables/stages/stageInputs'
import { useNodePentradoEditor } from '@/lib/pentradoHost'
import { useStageStore, type StageState } from '@/stores/stageStore'
import { onNodeConfigure, readWidgetStr } from '@/utils/widget'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const stageState = props.state
const stageStore = useStageStore()
const canvasEl = ref<InstanceType<typeof LayerEditorCanvas> | null>(null)
const fullscreen = ref(false)

const editor = useNodePentradoEditor(props.node, {
  onCaptured: (url) => stageStore.setOutputSlot(stageState, 0, url),
  onBatchCaptured: (json) => stageStore.setOutputSlot(stageState, 1, json),
})

const isCanvasStage = (props.node as any).comfyClass === 'ComfyTV.CanvasStage'
  || (props.node as any).type === 'ComfyTV.CanvasStage'
const sourceUrl = computed(() => isCanvasStage ? pickSourceImageUrl(stageState.inputs) : '')
const previewUrl = computed(() => stageState.output
  || readWidgetStr(props.node, 'captured_image', '')
  || sourceUrl.value
  || '')
let importingSource = false
let importedSource = ''

function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(`failed to load image: ${url}`))
    image.src = url
  })
}

async function importInitialSource(url: string): Promise<void> {
  if (!url || importingSource || importedSource === url || !editor.documentIsEmpty()) return
  importingSource = true
  importedSource = url
  try {
    const size = await loadImageSize(url)
    if (!editor.documentIsEmpty()) return
    const scale = Math.min(1, 4096 / Math.max(size.width, size.height))
    editor.setArtboardSize(
      Math.max(1, Math.round(size.width * scale)),
      Math.max(1, Math.round(size.height * scale)),
    )
    await editor.addImageFromUrl(url, 'Source')
    if (editor.floating.value) editor.anchorFloating()
    await editor.captureBatch()
  } catch (error) {
    console.warn('[ComfyTV/canvas] failed to import source image:', error)
  } finally {
    importingSource = false
  }
}

const stopSource = watch(sourceUrl, (url) => {
  if (url) void importInitialSource(url)
}, { immediate: true })

let unregisterPreRun: (() => void) | null = null
onMounted(() => {
  if (isCanvasStage) {
    unregisterPreRun = (props.node as any).__comfytvStageApi?.registerPreRun?.(
      () => editor.captureBatch(),
    ) ?? null
  }
})
onBeforeUnmount(() => {
  unregisterPreRun?.()
  stopSource()
})

function syncOutputSlots(): void {
  const image = readWidgetStr(props.node, 'captured_image', '')
  const images = readWidgetStr(props.node, 'captured_images', '')
  stageStore.setOutputSlot(stageState, 0, image || null)
  stageStore.setOutputSlot(stageState, 1, images || null)
}

onNodeConfigure(props.node, syncOutputSlots)
syncOutputSlots()

{
  const ops = createLayerEditorOps(editor)
  const hostApi = ((props.node as any).__comfytvStageApi ??= {})
  const layerEditor = {
    getState: ops.getState,
    resources: ops.resources,
    applyOps: ops.applyOps,
    isBusy: () => editor.capturing.value || editor.exportingPsd.value || editor.importingPsd.value,
    capture: async () => {
      const image = await editor.captureNow()
      if (!image) throw new Error('capture produced no output — see the ComfyTV tab for details')
      return { image }
    },
    captureBatch: async () => {
      await editor.captureBatch()
      return {
        image: editor.capturedImageUrl.value,
        images: readWidgetStr(props.node, 'captured_images', ''),
      }
    },
  }
  hostApi.layerEditor = layerEditor
  onBeforeUnmount(() => {
    if ((props.node as any).__comfytvStageApi?.layerEditor === layerEditor) {
      delete (props.node as any).__comfytvStageApi.layerEditor
    }
  })
}

async function openCanvas(): Promise<void> {
  if (fullscreen.value) return
  fullscreen.value = true
  await nextTick()
  editor.fitView()
}

async function toggleFullscreen(): Promise<void> {
  if (!fullscreen.value) {
    await openCanvas()
    return
  }
  if (isCanvasStage) await editor.captureBatch()
  fullscreen.value = false
}

const { onKeyDown, onKeyUp } = useLayerEditorHotkeys(editor, {
  setSpaceDown: (v) => canvasEl.value?.setSpaceDown(v),
  isFullscreen: () => fullscreen.value,
  exitFullscreen: () => { void toggleFullscreen() },
})

const iconToolBtnClass =
  'ctv:inline-flex ctv:size-7 ctv:items-center ctv:justify-center ctv:rounded-md ctv:border-0 ' +
  'ctv:bg-transparent ctv:text-muted-foreground ctv:cursor-pointer ctv:transition-colors ' +
  'ctv:hover:bg-secondary-background ctv:hover:text-base-foreground'
</script>
