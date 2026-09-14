import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import type { ResolvedInput, StageState } from '@/stores/stageStore'

const spawnMock = vi.hoisted(() => ({
  spawnImageVariationsFromSlots: vi.fn(),
  spawnImageMergeFromSlots: vi.fn(() => ({ id: 99 })),
}))

vi.mock('./spawnFollowUp', () => spawnMock)

import { useImagesSplit } from './useImagesSplit'

function makeNode(): any {
  return {
    outputs: Array.from({ length: 4 }, (_, i) => ({
      name: `image${i + 1}`,
      type: 'COMFYTV_IMAGE',
      links: [],
    })),
    addOutput(name: string, type: string, extra?: Record<string, string>) {
      this.outputs.push({ name, type, links: [], ...extra })
    },
    removeOutput(i: number) {
      this.outputs.splice(i, 1)
    },
  }
}

function makeState(content: string | null = null, source: ResolvedInput['source'] = 'empty'): StageState {
  const inputs: ResolvedInput[] = [
    { slot: 'images', type: 'COMFYTV_IMAGES', source, content },
  ]
  return reactive({
    kind: 'image', variant: 'transform',
    outputType: 'COMFYTV_IMAGE',
    output: null, outputs: [null],
    running: false, inputs, mainPrompt: '',
  }) as StageState
}

describe('useImagesSplit', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    spawnMock.spawnImageMergeFromSlots.mockClear()
    spawnMock.spawnImageVariationsFromSlots.mockClear()
  })

  it('splits a labeled image group onto matching output slots', async () => {
    const node = makeNode()
    const state = makeState(JSON.stringify({
      images: [
        { index: '1', label: 'Sky', image_url: '/sky.png' },
        { index: '2', label: 'Ground', image_url: '/g.png' },
      ],
    }), 'upstream')
    const { items, connected, truncated } = useImagesSplit(node, state)
    await nextTick()
    expect(connected.value).toBe(true)
    expect(truncated.value).toBe(false)
    expect(items.value.map(i => i.label)).toEqual(['Sky', 'Ground'])
    expect(node.outputs).toHaveLength(2)
    expect(node.outputs[0].label).toBe('Sky')
    expect(state.outputs[0]).toBe('/sky.png')
    expect(state.outputs[1]).toBe('/g.png')
  })

  it('updates when the upstream batch changes', async () => {
    const node = makeNode()
    const state = makeState(null, 'upstream-pending')
    const { items, connected } = useImagesSplit(node, state)
    expect(connected.value).toBe(true)
    expect(items.value).toEqual([])
    state.inputs[0].source = 'upstream'
    state.inputs[0].content = '/solo.png'
    await nextTick()
    expect(items.value).toEqual([{ index: '1', label: 'Layer 1', image_url: '/solo.png' }])
    expect(state.output).toBe('/solo.png')
  })

  it('keeps selection in range when the group shrinks', async () => {
    const node = makeNode()
    const state = makeState(JSON.stringify({
      images: [
        { index: '1', label: 'A', image_url: '/a' },
        { index: '2', label: 'B', image_url: '/b' },
        { index: '3', label: 'C', image_url: '/c' },
      ],
    }), 'upstream')
    const { selected, selectItem } = useImagesSplit(node, state)
    selectItem(2, { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent)
    expect(selected.value).toEqual([2])
    state.inputs[0].content = JSON.stringify({
      images: [{ index: '1', label: 'A', image_url: '/a' }],
    })
    await nextTick()
    expect(selected.value).toEqual([])
  })

  it('wires selected outputs into an Image Merge node', async () => {
    const node = makeNode()
    const state = makeState(JSON.stringify({
      images: [
        { index: '1', label: 'A', image_url: '/a' },
        { index: '2', label: 'B', image_url: '/b' },
        { index: '3', label: 'C', image_url: '/c' },
      ],
    }), 'upstream')
    const { selectItem, mergeSelected } = useImagesSplit(node, state)
    selectItem(0, { shiftKey: false, ctrlKey: true, metaKey: false } as MouseEvent)
    selectItem(2, { shiftKey: false, ctrlKey: true, metaKey: false } as MouseEvent)
    mergeSelected()
    expect(spawnMock.spawnImageMergeFromSlots).toHaveBeenCalledWith(node, [0, 2])
  })
})
