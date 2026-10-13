import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

import type { ResolvedInput, StageState } from '@/stores/stageStore'

const spawnMock = vi.hoisted(() => ({
  spawnImageVariationsFromSlots: vi.fn(),
  spawnImageMergeFromSlots: vi.fn(() => ({ id: 99 })),
}))

const uploadMock = vi.hoisted(() => ({
  uploadBlob: vi.fn(async () => '/view?filename=squared.png'),
}))

vi.mock('./spawnFollowUp', () => spawnMock)
vi.mock('@/utils/uploadCanvas', () => uploadMock)

import { squareImageCanvas, useImagesSplit } from './useImagesSplit'

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

function withScope<T>(fn: () => T): T {
  // Keep the scope alive for the test body (watches / toolbar registration).
  return effectScope(true).run(fn) as T
}

describe('squareImageCanvas', () => {
  it('pads a landscape image to a square on the long side', () => {
    const img = {
      naturalWidth: 200,
      naturalHeight: 100,
      width: 200,
      height: 100,
    } as HTMLImageElement
    const canvas = squareImageCanvas(img)
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(200)
  })
})

describe('useImagesSplit', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    spawnMock.spawnImageMergeFromSlots.mockClear()
    spawnMock.spawnImageVariationsFromSlots.mockClear()
    uploadMock.uploadBlob.mockClear()
  })

  it('splits a labeled image group onto matching output slots', async () => {
    const node = makeNode()
    const state = makeState(JSON.stringify({
      images: [
        { index: '1', label: 'Sky', image_url: '/sky.png' },
        { index: '2', label: 'Ground', image_url: '/g.png' },
      ],
    }), 'upstream')
    const { items, connected, truncated } = withScope(() => useImagesSplit(node, state))
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
    const { items, connected } = withScope(() => useImagesSplit(node, state))
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
    const { selected, selectItem } = withScope(() => useImagesSplit(node, state))
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
    const { selectItem, mergeSelected } = withScope(() => useImagesSplit(node, state))
    selectItem(0, { shiftKey: false, ctrlKey: true, metaKey: false } as MouseEvent)
    selectItem(2, { shiftKey: false, ctrlKey: true, metaKey: false } as MouseEvent)
    mergeSelected()
    expect(spawnMock.spawnImageMergeFromSlots).toHaveBeenCalledWith(node, [0, 2])
  })

  it('squares selected images in-node without spawning merge', async () => {
    const node = makeNode()
    const state = makeState(JSON.stringify({
      images: [
        { index: '1', label: 'A', image_url: '/a' },
        { index: '2', label: 'B', image_url: '/b' },
      ],
    }), 'upstream')

    vi.stubGlobal('Image', class {
      naturalWidth = 40
      naturalHeight = 20
      width = 40
      height = 20
      crossOrigin = ''
      onload: ((ev?: any) => void) | null = null
      onerror: ((ev?: any) => void) | null = null
      set src(_v: string) {
        queueMicrotask(() => this.onload?.(null))
      }
    })
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['x'], { type: 'image/png' }))
    }

    const api = withScope(() => useImagesSplit(node, state))
    expect(api.canSquare.value).toBe(false)
    api.selectItem(1, { shiftKey: false, ctrlKey: false, metaKey: false } as MouseEvent)
    expect(api.canSquare.value).toBe(true)
    await api.squareSelected()
    expect(spawnMock.spawnImageMergeFromSlots).not.toHaveBeenCalled()
    expect(uploadMock.uploadBlob).toHaveBeenCalled()
    expect(api.items.value[1].image_url).toBe('/view?filename=squared.png')
    expect(state.outputs[1]).toBe('/view?filename=squared.png')
    expect(state.outputs[0]).toBe('/a')
  })
})
