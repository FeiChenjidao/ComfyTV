import { computed, ref } from 'vue'

import type { Asset } from '@/api/schemas'
import { useAssetStore } from '@/stores/assetStore'

export type TagState = 'all' | 'some' | 'none'

export const TAG_EDITOR_WIDTH = 176

export function useAssetTagEditor() {
  const store = useAssetStore()

  const tagEditor = ref<{ assetIds: number[]; x: number; y: number } | null>(null)

  const editorAssets = computed<Asset[]>(() =>
    tagEditor.value
      ? tagEditor.value.assetIds
          .map(id => store.byId(id))
          .filter((a): a is Asset => !!a)
      : [],
  )

  const tagEditorStyle = computed(() =>
    tagEditor.value
      ? { left: `${tagEditor.value.x}px`, top: `${tagEditor.value.y}px` }
      : {},
  )

  function openTagEditor(assetIds: number[], x: number, y: number) {
    if (!assetIds.length) return
    tagEditor.value = {
      assetIds: [...assetIds],
      x: Math.min(Math.max(8, x), window.innerWidth - TAG_EDITOR_WIDTH - 8),
      y,
    }
  }

  function closeTagEditor() {
    tagEditor.value = null
  }

  function editorTagState(catId: number): TagState {
    const rows = editorAssets.value
    if (!rows.length) return 'none'
    const n = rows.filter(a => a.category_ids.includes(catId)).length
    if (n === 0) return 'none'
    return n === rows.length ? 'all' : 'some'
  }

  function toggleTag(catId: number) {
    const rows = editorAssets.value
    if (!rows.length) return
    const state = editorTagState(catId)
    if (rows.length === 1) {
      const a = rows[0]
      if (state === 'all') void store.removeTag(a.id, catId)
      else void store.addTag(a.id, catId)
      return
    }
    const ids = rows.map(a => a.id)
    void store.bulkUpdateTags(ids, state === 'all' ? { remove: [catId] } : { add: [catId] })
  }

  return {
    tagEditor,
    tagEditorStyle,
    editorAssets,
    openTagEditor,
    closeTagEditor,
    editorTagState,
    toggleTag,
  }
}
