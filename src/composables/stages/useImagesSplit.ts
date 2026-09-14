import { computed, ref, watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { app } from '@/lib/comfyApp'
import { t } from '@/i18n'
import { useStageStore, type StageState } from '@/stores/stageStore'
import {
  spawnImageMergeFromSlots,
  spawnImageVariationsFromSlots,
} from '@/composables/stages/spawnFollowUp'

import { slotIndexesInDocumentOrder } from './imageMerge'
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

export function useImagesSplit(node: LGraphNode, state: StageState) {
  const store = useStageStore()
  const items = ref<ImageGroupItem[]>([])
  const truncated = ref(false)
  const selected = ref<number[]>([])
  const actionError = ref('')
  let lastAnchor = 0

  const connected = computed(() => {
    const inp = state.inputs.find(i => i.slot === 'images')
    return inp?.source === 'upstream' || inp?.source === 'upstream-pending'
  })

  const selectedSet = computed(() => new Set(selected.value))
  const canMerge = computed(() => selected.value.length >= 2)
  const canVariations = computed(() => selected.value.length >= 1)

  function apply(raw: string | null | undefined) {
    const { items: next, truncated: trunc } = syncImagesSplitStage(
      node, raw, urls => store.setOutputSlots(state, urls),
    )
    truncated.value = trunc
    items.value = next
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

  if (node) {
    const orig = node.onConfigure
    node.onConfigure = function (info: unknown) {
      orig?.call(this, info)
      apply(state.inputs.find(i => i.slot === 'images')?.content ?? '')
    }
  }

  return {
    items, truncated, connected, max: IMAGES_SPLIT_MAX,
    selected, selectedSet, canMerge, canVariations, actionError,
    selectItem, mergeSelected, spawnVariations,
  }
}
