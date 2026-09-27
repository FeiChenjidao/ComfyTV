import { describe, expect, it, vi } from 'vitest'

import { bindStageWidgets } from '@/composables/stages/stageWidgetSync'

describe('bindStageWidgets', () => {
  it('restores the saved picker index and pool after node configuration', () => {
    const selectedIndex = { name: 'selected_index', value: 1, callback: undefined as (() => void) | undefined }
    const pool = { name: 'pool', value: '', callback: undefined as (() => void) | undefined }
    const savedPool = JSON.stringify({ images: [{ image_url: '/view?filename=a.png' }] })
    const node = {
      widgets: [selectedIndex, pool],
      onConfigure() {
        selectedIndex.value = 3
        pool.value = savedPool
      },
    }
    const state = { pickedIndex: 1, pool: null } as any

    bindStageWidgets({
      node,
      state,
      store: {} as any,
      kind: 'image-picker',
      variant: 'generator',
      applyPickedIndex: vi.fn(),
    })
    node.onConfigure()

    expect(state.pickedIndex).toBe(3)
    expect(state.pool).toBe(savedPool)
  })
})
