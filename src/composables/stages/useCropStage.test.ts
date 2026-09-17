import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import type { ResolvedInput, StageState } from '@/stores/stageStore'
import { useStageStore } from '@/stores/stageStore'

const uploadCanvas = vi.hoisted(() => vi.fn(async (_c: unknown, opts: { filename: string }) =>
  `/view?filename=${opts.filename}&subfolder=comfytv/cropper&type=input`))

vi.mock('@/utils/uploadCanvas', () => ({
  uploadCanvas: (...a: unknown[]) => uploadCanvas(...a),
}))

import {
  clampCropRect,
  cropToCanvas,
  defaultCropBox,
  parseCropBoxes,
  serializeCropBoxes,
  useCropStage,
} from './useCropStage'

function makeWidget(name: string, value: unknown = 0) {
  return { name, value, callback: vi.fn() }
}

function makeNode(b: Partial<{ x: number; y: number; w: number; h: number; boxes: string }> = {}): any {
  return {
    id: 5,
    widgets: [
      makeWidget('crop_x', b.x ?? 0),
      makeWidget('crop_y', b.y ?? 0),
      makeWidget('crop_w', b.w ?? 0),
      makeWidget('crop_h', b.h ?? 0),
      makeWidget('crop_boxes', b.boxes ?? '[]'),
      makeWidget('selected_index', 1),
    ],
    onConfigure: null as any,
  }
}

function makeState(image: string | null = '/img.png'): StageState {
  const inputs: ResolvedInput[] = image == null
    ? [{ slot: 'image', type: 'COMFYTV_IMAGE', source: 'empty', content: null }]
    : [{ slot: 'image', type: 'COMFYTV_IMAGE', source: 'upstream', content: image }]
  return reactive({
    kind: 'image-batch', variant: 'transform',
    outputType: 'COMFYTV_IMAGES',
    output: null, outputs: [null, null],
    running: false, inputs, mainPrompt: '',
  }) as unknown as StageState
}

beforeEach(() => {
  setActivePinia(createPinia())
  uploadCanvas.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('clampCropRect', () => {
  it('rounds and passes through in-range bounds', () => {
    expect(clampCropRect({ x: 10.4, y: 20.6, width: 100.2, height: 50.5 }, 640, 480))
      .toEqual({ sx: 10, sy: 21, sw: 100, sh: 51 })
  })

  it('clamps the origin into the image', () => {
    expect(clampCropRect({ x: -50, y: 9999, width: 10, height: 10 }, 640, 480))
      .toEqual({ sx: 0, sy: 479, sw: 10, sh: 1 })
  })

  it('limits size to the remaining image and enforces a 1px minimum', () => {
    expect(clampCropRect({ x: 600, y: 400, width: 500, height: 500 }, 640, 480))
      .toEqual({ sx: 600, sy: 400, sw: 40, sh: 80 })
    expect(clampCropRect({ x: 0, y: 0, width: 0, height: -5 }, 640, 480))
      .toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 })
  })
})

describe('cropToCanvas', () => {
  it('draws the clamped source rect onto a matching canvas', () => {
    const drawImage = vi.fn()
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as never)
    try {
      const img = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement
      const canvas = cropToCanvas(img, { x: 10, y: 20, width: 100, height: 50 })
      expect(canvas.width).toBe(100)
      expect(canvas.height).toBe(50)
      expect(drawImage).toHaveBeenCalledWith(img, 10, 20, 100, 50, 0, 0, 100, 50)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('parse/serialize crop boxes', () => {
  it('round-trips boxes', () => {
    const raw = serializeCropBoxes([
      { id: 'a', x: 1, y: 2, width: 3, height: 4 },
      { id: 'b', x: 5, y: 6, width: 7, height: 8 },
    ])
    expect(parseCropBoxes(raw)).toEqual([
      { id: 'a', x: 1, y: 2, width: 3, height: 4 },
      { id: 'b', x: 5, y: 6, width: 7, height: 8 },
    ])
  })

  it('accepts width/height aliases', () => {
    expect(parseCropBoxes('[{"id":"z","x":0,"y":0,"width":10,"height":20}]'))
      .toEqual([{ id: 'z', x: 0, y: 0, width: 10, height: 20 }])
  })

  it('builds a centered default box', () => {
    const b = defaultCropBox(100, 100)
    expect(b.width).toBe(70)
    expect(b.height).toBe(70)
    expect(b.x).toBe(15)
    expect(b.y).toBe(15)
  })
})

describe('useCropStage', () => {
  it('seeds a single box from legacy crop widgets', () => {
    const api = useCropStage(makeNode({ x: 1, y: 2, w: 3, h: 4 }), makeState())
    expect(api.boxes.value).toHaveLength(1)
    expect(api.bounds.value).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })

  it('seeds multiple boxes from crop_boxes JSON', () => {
    const boxes = serializeCropBoxes([
      { id: 'a', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', x: 20, y: 20, width: 30, height: 30 },
    ])
    const api = useCropStage(makeNode({ boxes }), makeState())
    expect(api.boxes.value.map(b => b.id)).toEqual(['a', 'b'])
    expect(api.selectedId.value).toBe('a')
  })

  it('writes boxes JSON and legacy widgets when bounds change', async () => {
    const node = makeNode({ w: 10, h: 10 })
    const api = useCropStage(node, makeState())
    api.setBounds({ x: 5, y: 6, width: 7, height: 8 })
    await nextTick()
    expect(node.widgets.find((w: any) => w.name === 'crop_x').value).toBe(5)
    expect(node.widgets.find((w: any) => w.name === 'crop_w').value).toBe(7)
    const parsed = parseCropBoxes(String(node.widgets.find((w: any) => w.name === 'crop_boxes').value))
    expect(parsed[0]).toMatchObject({ x: 5, y: 6, width: 7, height: 8 })
  })

  it('adds and removes boxes', async () => {
    const api = useCropStage(makeNode({ w: 40, h: 40 }), makeState())
    expect(api.canRemove.value).toBe(false)
    api.addBox(200, 200)
    expect(api.boxes.value).toHaveLength(2)
    expect(api.canRemove.value).toBe(true)
    api.removeSelected()
    expect(api.boxes.value).toHaveLength(1)
    expect(api.canRemove.value).toBe(false)
  })

  it('uploads each box and emits a batch payload', async () => {
    const drawImage = vi.fn()
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as never)
    // Fake Image so getSourceImage resolves
    class FakeImage {
      crossOrigin = ''
      complete = true
      naturalWidth = 100
      naturalHeight = 100
      onload: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      set src(_v: string) { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', FakeImage as any)

    try {
      const boxes = serializeCropBoxes([
        { id: 'a', x: 0, y: 0, width: 20, height: 20 },
        { id: 'b', x: 30, y: 30, width: 20, height: 20 },
      ])
      const node = makeNode({ boxes })
      const state = makeState('/img.png')
      const store = useStageStore()
      const apply = vi.spyOn(store, 'applyExecutedPayload')
      useCropStage(node, state)
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
      expect(uploadCanvas).toHaveBeenCalledTimes(2)
      expect(apply).toHaveBeenCalled()
      const payload = apply.mock.calls.at(-1)![1] as any
      const batch = JSON.parse(payload.output[0])
      expect(batch.images).toHaveLength(2)
      expect(payload.picked[0]).toContain('comfytv-crop')
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})
