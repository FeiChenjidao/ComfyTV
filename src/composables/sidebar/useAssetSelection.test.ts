import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const store = {
  assets: [] as any[],
  bulkRemove: vi.fn(async (ids: number[]) => ids),
}

vi.mock('@/stores/assetStore', () => ({ useAssetStore: () => store }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('@/composables/dialog/useConfirmDialog', () => ({
  askConfirm: vi.fn(async () => false),
}))
vi.mock('@/composables/stages/assetLoaderNode', () => ({
  createAssetLoaderNode: vi.fn(),
  canvasCenter: vi.fn(() => [10, 20]),
}))

import { askConfirm } from '@/composables/dialog/useConfirmDialog'
import { createAssetLoaderNode } from '@/composables/stages/assetLoaderNode'

import { useAssetSelection } from './useAssetSelection'

function row(id: number, media_type = 'image') {
  return { id, media_type, category_ids: [] } as any
}

function setup(ids: number[] = [1, 2, 3, 4]) {
  store.assets = ids.map(id => row(id))
  const visible = ref(store.assets.slice())
  return { visible, sel: useAssetSelection(visible) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useAssetSelection', () => {
  it('starts idle and ignores plain clicks outside select mode', () => {
    const { sel } = setup()
    expect(sel.selectMode.value).toBe(false)
    expect(sel.onCardClick(row(1), {} as any)).toBe(false)
    expect(sel.selectedCount.value).toBe(0)
  })

  it('ctrl/meta click enters select mode and toggles the card', () => {
    const { sel } = setup()
    expect(sel.onCardClick(row(2), { ctrlKey: true } as any)).toBe(true)
    expect(sel.selectMode.value).toBe(true)
    expect(sel.isSelected(2)).toBe(true)
    sel.onCardClick(row(2), { metaKey: true } as any)
    expect(sel.isSelected(2)).toBe(false)
  })

  it('shift click selects the visible range from the last toggled card', () => {
    const { sel } = setup()
    sel.enterSelectMode()
    sel.onCardClick(row(1), {} as any)
    sel.onCardClick(row(3), { shiftKey: true } as any)
    expect([...sel.selectedIds.value].sort()).toEqual([1, 2, 3])
  })

  it('toggleSelectAll covers the visible rows and then clears only them', () => {
    const { sel, visible } = setup()
    sel.enterSelectMode()
    sel.toggleSelected(4)
    visible.value = [row(1), row(2)]
    sel.toggleSelectAll()
    expect(sel.allVisibleSelected.value).toBe(true)
    expect([...sel.selectedIds.value].sort()).toEqual([1, 2, 4])
    sel.toggleSelectAll()
    expect([...sel.selectedIds.value]).toEqual([4])
  })

  it('dragIds carries the selection only for a selected card in select mode', () => {
    const { sel } = setup()
    expect(sel.dragIds(row(1))).toEqual([1])
    sel.enterSelectMode()
    sel.toggleSelected(1)
    sel.toggleSelected(3)
    expect(sel.dragIds(row(3))).toEqual([1, 3])
    expect(sel.dragIds(row(2))).toEqual([2])
  })

  it('toggleSelectMode enters, then leaves and clears the selection', () => {
    const { sel } = setup()
    sel.toggleSelectMode()
    expect(sel.selectMode.value).toBe(true)
    sel.toggleSelected(2)
    sel.toggleSelectMode()
    expect(sel.selectMode.value).toBe(false)
    expect(sel.selectedCount.value).toBe(0)
  })

  it('exitSelectMode clears everything', () => {
    const { sel } = setup()
    sel.enterSelectMode()
    sel.toggleSelected(1)
    sel.exitSelectMode()
    expect(sel.selectMode.value).toBe(false)
    expect(sel.selectedCount.value).toBe(0)
  })

  it('loadSelectedNodes spawns one stepped node per non-model asset', () => {
    const { sel } = setup()
    store.assets = [row(1), row(2, 'model'), row(3)]
    sel.enterSelectMode()
    sel.toggleSelected(1)
    sel.toggleSelected(2)
    sel.toggleSelected(3)
    sel.loadSelectedNodes()
    expect(createAssetLoaderNode).toHaveBeenCalledTimes(2)
    expect(createAssetLoaderNode).toHaveBeenNthCalledWith(1, store.assets[0], [10, 20], expect.anything())
    expect(createAssetLoaderNode).toHaveBeenNthCalledWith(2, store.assets[2], [50, 60], expect.anything())
  })

  it('removeSelected asks first and does nothing when declined', async () => {
    const { sel } = setup()
    sel.enterSelectMode()
    sel.toggleSelected(1)
    expect(await sel.removeSelected()).toBe(false)
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }))
    expect(store.bulkRemove).not.toHaveBeenCalled()
  })

  it('removeSelected calls bulkRemove and the selection follows the store', async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(true)
    const { sel } = setup()
    sel.enterSelectMode()
    sel.toggleSelected(1)
    sel.toggleSelected(2)
    store.bulkRemove.mockImplementationOnce(async (ids: number[]) => {
      store.assets = store.assets.filter(a => !ids.includes(a.id))
      return ids
    })
    expect(await sel.removeSelected()).toBe(true)
    expect(store.bulkRemove).toHaveBeenCalledWith([1, 2])
    await nextTick()
    expect(sel.selectedCount.value).toBe(0)
    expect(sel.selectMode.value).toBe(true)
  })

  it('removeSelected reports failure and keeps the selection', async () => {
    vi.mocked(askConfirm).mockResolvedValueOnce(true)
    store.bulkRemove.mockResolvedValueOnce(null as any)
    const { sel } = setup()
    sel.enterSelectMode()
    sel.toggleSelected(1)
    expect(await sel.removeSelected()).toBe(false)
    expect(sel.isSelected(1)).toBe(true)
  })
})
