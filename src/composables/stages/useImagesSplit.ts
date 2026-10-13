import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { app } from '@/lib/comfyApp'
import { t } from '@/i18n'
import { useStageStore, type StageState } from '@/stores/stageStore'
import {
  spawnImageMergeFromSlots,
  spawnImageVariationsFromSlots,
} from '@/composables/stages/spawnFollowUp'
import { containFitSquare, slotIndexesInDocumentOrder } from '@/composables/stages/imageMerge'
import { uploadBlob } from '@/utils/uploadCanvas'
import {
  registerToolbarHandlers,
  setToolbarDisabled,
} from '@/v2/nodeToolbar'
import {
  IMAGES_SPLIT_MAX,
  rangeSelectIndexes,
  syncImagesSplitStage,
  type ImageGroupItem,
} from './imagesSplit'

export function viewToAbsolute(url: string): string {
  const raw = url.replace(/^\/api/, '')
  const api = (app as any)?.api
  return typeof api?.apiURL === 'function' ? api.apiURL(raw) : raw
}

export function loadLayerImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = viewToAbsolute(url)
  })
}

/** Pad image to a square on the long side (same idea as Image Merge 1:1). */
export function squareImageCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const w = Math.max(1, Math.round(img.naturalWidth || img.width || 1))
  const h = Math.max(1, Math.round(img.naturalHeight || img.height || 1))
  return containFitSquare(img, Math.max(w, h))
}

export function useImagesSplit(node: LGraphNode, state: StageState) {
  const store = useStageStore()
  const items = ref<ImageGroupItem[]>([])
  /** Upstream URLs before local 1:1 overrides (keyed for override map). */
  const sourceUrls = ref<string[]>([])
  /** original upstream url → squared view url */
  const squareBySource = ref<Record<string, string>>({})
  const truncated = ref(false)
  const selected = ref<number[]>([])
  const actionError = ref('')
  const squaring = ref(false)
  let lastAnchor = 0
  let squareSeq = 0

  const connected = computed(() => {
    const inp = state.inputs.find(i => i.slot === 'images')
    return inp?.source === 'upstream' || inp?.source === 'upstream-pending'
  })

  const selectedSet = computed(() => new Set(selected.value))
  const canMerge = computed(() => selected.value.length >= 2 && !squaring.value)
  const canSquare = computed(() => selected.value.length >= 1 && !squaring.value)
  const canVariations = computed(() => selected.value.length >= 1 && !squaring.value)

  function displayItems(rawItems: ImageGroupItem[]): ImageGroupItem[] {
    return rawItems.map((it) => {
      const sq = squareBySource.value[it.image_url]
      return sq ? { ...it, image_url: sq } : it
    })
  }

  function writeSlots(urls: Array<string | null>) {
    store.setOutputSlots(
      state,
      urls.map((u) => (u && squareBySource.value[u]) || u),
    )
  }

  function apply(raw: string | null | undefined) {
    const { items: next, truncated: trunc } = syncImagesSplitStage(
      node, raw, writeSlots,
    )
    truncated.value = trunc
    sourceUrls.value = next.map(it => it.image_url)
    const live = new Set(sourceUrls.value)
    for (const k of Object.keys(squareBySource.value)) {
      if (!live.has(k)) delete squareBySource.value[k]
    }
    items.value = displayItems(next)
    selected.value = selected.value.filter(i => i >= 0 && i < next.length)
  }

  function selectItem(index: number, e: MouseEvent) {
    if (index < 0 || index >= items.value.length) return
    if (e.shiftKey) {
      selected.value = rangeSelectIndexes(
        items.value.map((_, i) => i),
        lastAnchor,
        index,
      )
      return
    }
    if (e.ctrlKey || e.metaKey) {
      const set = new Set(selected.value)
      if (set.has(index)) set.delete(index)
      else set.add(index)
      selected.value = [...set].sort((a, b) => a - b)
      lastAnchor = index
      return
    }
    selected.value = [index]
    lastAnchor = index
  }

  function mergeSelected() {
    const slots = slotIndexesInDocumentOrder(items.value, selected.value)
    if (slots.length < 2) return
    actionError.value = ''
    const created = spawnImageMergeFromSlots(node, slots)
    if (!created) actionError.value = t('imagesSplit.mergeFailed')
  }

  /** Make selected images 1:1 inside this node (pad to long side, upload, override slots). */
  async function squareSelected() {
    const idxs = slotIndexesInDocumentOrder(items.value, selected.value)
    if (!idxs.length || squaring.value) return
    actionError.value = ''
    const mySeq = ++squareSeq
    squaring.value = true
    try {
      const nextOverrides = { ...squareBySource.value }
      for (const i of idxs) {
        const src = sourceUrls.value[i]
        if (!src) continue
        const img = await loadLayerImage(nextOverrides[src] || src)
        if (mySeq !== squareSeq) return
        const canvas = squareImageCanvas(img)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        canvas.width = 0
        canvas.height = 0
        if (!blob) throw new Error('toBlob returned null')
        if (mySeq !== squareSeq) return
        const viewUrl = await uploadBlob(blob, {
          subfolder: 'comfytv/transformer',
          filename: `comfytv-split-1x1-${node?.id ?? 'x'}-${i}-${Date.now()}.png`,
        })
        if (mySeq !== squareSeq) return
        nextOverrides[src] = viewUrl
      }
      squareBySource.value = nextOverrides
      apply(state.inputs.find(i => i.slot === 'images')?.content ?? '')
    } catch (e) {
      console.error('[ComfyTV/images-split] 1:1 failed', e)
      actionError.value = t('imagesSplit.squareFailed')
    } finally {
      if (mySeq === squareSeq) squaring.value = false
    }
  }

  function spawnVariations() {
    if (!selected.value.length) return
    actionError.value = ''
    spawnImageVariationsFromSlots(node, selected.value)
  }

  watch(
    () => state.inputs.find(i => i.slot === 'images')?.content ?? '',
    (raw) => apply(raw),
    { immediate: true },
  )

  watch(
    [canMerge, canSquare, canVariations],
    () => {
      setToolbarDisabled(node, {
        'split:merge': !canMerge.value,
        'split:square': !canSquare.value,
        'split:variations': !canVariations.value,
      })
    },
    { immediate: true },
  )

  const disposeHandlers = registerToolbarHandlers(node, {
    'split:merge': () => mergeSelected(),
    'split:square': () => { void squareSelected() },
    'split:variations': () => spawnVariations(),
  })
  if (getCurrentScope()) onScopeDispose(disposeHandlers)

  if (node) {
    const orig = node.onConfigure
    node.onConfigure = function (
      info: Parameters<NonNullable<LGraphNode['onConfigure']>>[0],
    ) {
      orig?.call(this, info)
      apply(state.inputs.find(i => i.slot === 'images')?.content ?? '')
    }
  }

  return {
    items, truncated, connected, max: IMAGES_SPLIT_MAX,
    selected, selectedSet, canMerge, canSquare, canVariations, actionError, squaring,
    selectItem, mergeSelected, squareSelected, spawnVariations,
  }
}
