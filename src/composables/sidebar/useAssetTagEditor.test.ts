import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
  assets: [] as any[],
  byId: vi.fn((id: number) => store.assets.find(a => a.id === id)),
  addTag: vi.fn(),
  removeTag: vi.fn(),
  bulkUpdateTags: vi.fn(async () => []),
}

vi.mock('@/stores/assetStore', () => ({ useAssetStore: () => store }))

import { TAG_EDITOR_WIDTH, useAssetTagEditor } from './useAssetTagEditor'

beforeEach(() => {
  vi.clearAllMocks()
  store.assets = [
    { id: 1, category_ids: [10] },
    { id: 2, category_ids: [10, 20] },
    { id: 3, category_ids: [] },
  ]
})

describe('useAssetTagEditor', () => {
  it('opens clamped to the viewport and closes', () => {
    const ed = useAssetTagEditor()
    ed.openTagEditor([1], -50, 30)
    expect(ed.tagEditor.value).toEqual({ assetIds: [1], x: 8, y: 30 })
    expect(ed.tagEditorStyle.value).toEqual({ left: '8px', top: '30px' })
    ed.openTagEditor([1], window.innerWidth + 100, 30)
    expect(ed.tagEditor.value?.x).toBe(window.innerWidth - TAG_EDITOR_WIDTH - 8)
    ed.closeTagEditor()
    expect(ed.tagEditor.value).toBeNull()
    expect(ed.tagEditorStyle.value).toEqual({})
  })

  it('ignores an empty target list', () => {
    const ed = useAssetTagEditor()
    ed.openTagEditor([], 0, 0)
    expect(ed.tagEditor.value).toBeNull()
  })

  it('reports all / some / none across the targeted assets', () => {
    const ed = useAssetTagEditor()
    ed.openTagEditor([1, 2, 3], 0, 0)
    expect(ed.editorTagState(10)).toBe('some')
    expect(ed.editorTagState(20)).toBe('some')
    expect(ed.editorTagState(30)).toBe('none')
    ed.openTagEditor([1, 2], 0, 0)
    expect(ed.editorTagState(10)).toBe('all')
    expect(ed.editorTagState(999)).toBe('none')
  })

  it('a single target uses the per-asset add/remove calls', () => {
    const ed = useAssetTagEditor()
    ed.openTagEditor([2], 0, 0)
    ed.toggleTag(10)
    expect(store.removeTag).toHaveBeenCalledWith(2, 10)
    ed.toggleTag(30)
    expect(store.addTag).toHaveBeenCalledWith(2, 30)
    expect(store.bulkUpdateTags).not.toHaveBeenCalled()
  })

  it('several targets go through bulkUpdateTags: some/none adds, all removes', () => {
    const ed = useAssetTagEditor()
    ed.openTagEditor([1, 2, 3], 0, 0)
    ed.toggleTag(10)
    expect(store.bulkUpdateTags).toHaveBeenLastCalledWith([1, 2, 3], { add: [10] })
    ed.openTagEditor([1, 2], 0, 0)
    ed.toggleTag(10)
    expect(store.bulkUpdateTags).toHaveBeenLastCalledWith([1, 2], { remove: [10] })
    expect(store.addTag).not.toHaveBeenCalled()
  })

  it('drops ids the store no longer knows and is a no-op with none left', () => {
    const ed = useAssetTagEditor()
    ed.openTagEditor([1, 42], 0, 0)
    expect(ed.editorAssets.value.map(a => a.id)).toEqual([1])
    ed.openTagEditor([42], 0, 0)
    ed.toggleTag(10)
    expect(store.addTag).not.toHaveBeenCalled()
    expect(store.bulkUpdateTags).not.toHaveBeenCalled()
  })
})
