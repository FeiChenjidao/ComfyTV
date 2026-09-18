import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { Asset } from '@/api/schemas'
import { askConfirm } from '@/composables/dialog/useConfirmDialog'
import { canvasCenter, createAssetLoaderNode } from '@/composables/stages/assetLoaderNode'
import { useAssetStore } from '@/stores/assetStore'

const LOAD_STEP = 40

export function useAssetSelection(visibleAssets: Ref<Asset[]>) {
  const { t } = useI18n()
  const store = useAssetStore()

  const selectMode = ref(false)
  const selectedIds = ref<Set<number>>(new Set())
  const removing = ref(false)
  let anchorId: number | null = null

  const selectedAssets = computed<Asset[]>(() =>
    store.assets.filter(a => selectedIds.value.has(a.id)))
  const selectedCount = computed(() => selectedIds.value.size)
  const allVisibleSelected = computed(() =>
    visibleAssets.value.length > 0
      && visibleAssets.value.every(a => selectedIds.value.has(a.id)))

  function isSelected(id: number): boolean {
    return selectedIds.value.has(id)
  }

  function enterSelectMode() {
    selectMode.value = true
  }

  function exitSelectMode() {
    selectMode.value = false
    selectedIds.value = new Set()
    anchorId = null
  }

  function toggleSelectMode() {
    if (selectMode.value) exitSelectMode()
    else enterSelectMode()
  }

  function toggleSelected(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    anchorId = id
  }

  function selectRange(id: number) {
    const rows = visibleAssets.value
    const i = rows.findIndex(a => a.id === id)
    if (i < 0) return
    const j = anchorId === null ? -1 : rows.findIndex(a => a.id === anchorId)
    const from = j < 0 ? i : Math.min(i, j)
    const to = j < 0 ? i : Math.max(i, j)
    const next = new Set(selectedIds.value)
    for (let k = from; k <= to; k++) next.add(rows[k].id)
    selectedIds.value = next
  }

  function toggleSelectAll() {
    const next = new Set(selectedIds.value)
    if (allVisibleSelected.value) {
      for (const a of visibleAssets.value) next.delete(a.id)
    } else {
      for (const a of visibleAssets.value) next.add(a.id)
    }
    selectedIds.value = next
  }

  function onCardClick(asset: Asset, e: MouseEvent): boolean {
    if (!selectMode.value) {
      if (!(e.ctrlKey || e.metaKey)) return false
      selectMode.value = true
    }
    if (e.shiftKey) selectRange(asset.id)
    else toggleSelected(asset.id)
    return true
  }

  function dragIds(asset: Asset): number[] {
    return selectMode.value && selectedIds.value.has(asset.id)
      ? selectedAssets.value.map(a => a.id)
      : [asset.id]
  }

  function loadSelectedNodes() {
    const [cx, cy] = canvasCenter()
    selectedAssets.value
      .filter(a => a.media_type !== 'model')
      .forEach((a, i) => {
        createAssetLoaderNode(a, [cx + i * LOAD_STEP, cy + i * LOAD_STEP], {
          anchor: 'center',
          select: true,
        })
      })
  }

  async function removeSelected(): Promise<boolean> {
    const ids = selectedAssets.value.map(a => a.id)
    if (!ids.length || removing.value) return false
    const ok = await askConfirm({
      title: t('assets.select.remove'),
      message: t('assets.select.removeConfirm', { count: ids.length }),
      danger: true,
    })
    if (!ok) return false
    removing.value = true
    try {
      const deleted = await store.bulkRemove(ids)
      if (deleted === null) return false
      const gone = new Set(deleted)
      selectedIds.value = new Set([...selectedIds.value].filter(id => !gone.has(id)))
      return true
    } finally {
      removing.value = false
    }
  }

  watch(() => store.assets, (rows) => {
    if (!selectedIds.value.size) return
    const alive = new Set(rows.map(a => a.id))
    const next = new Set([...selectedIds.value].filter(id => alive.has(id)))
    if (next.size !== selectedIds.value.size) selectedIds.value = next
  })

  return {
    selectMode,
    selectedIds,
    selectedAssets,
    selectedCount,
    allVisibleSelected,
    removing,
    isSelected,
    enterSelectMode,
    exitSelectMode,
    toggleSelectMode,
    toggleSelected,
    selectRange,
    toggleSelectAll,
    onCardClick,
    dragIds,
    loadSelectedNodes,
    removeSelected,
  }
}
