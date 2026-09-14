import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import type { ResolvedInput, StageState } from '@/stores/stageStore'
import { useStageStore } from '@/stores/stageStore'

import {
  assignFaceLabel,
  cellsFromSplits,
  cellOverlayStyle,
  clampSplit,
  cycleFaceLabel,
  DEFAULT_H_SPLITS,
  DEFAULT_V_SPLITS,
  edgesFromSplits,
  ensureFaceLabels,
  FACE_LABELS,
  faceRank,
  findCustomSplitTileSlot,
  findModel3DFaceSlot,
  fractionAlongAxis,
  imageScreenRect,
  insertInLargestGap,
  MAX_SPLITS,
  MIN_SPLIT_GAP,
  orderByFaceLabels,
  parseCellLabels,
  parseSplits,
  removeSplitAt,
  serializeCellLabels,
  serializeSplits,
  setSplitAt,
  splitBandStyle,
  splitDelta,
  syncCustomSplitOutputs,
  useCustomSplit,
} from './useCustomSplit'

vi.mock('@/utils/uploadCanvas', () => ({
  uploadCanvas: vi.fn(async () => 'https://x/out.png'),
}))
import { uploadCanvas } from '@/utils/uploadCanvas'

let imageCtorCount = 0

class FakeImage {
  onload: (() => void) | null = null
  onerror: ((e?: unknown) => void) | null = null
  crossOrigin = ''
  naturalWidth = 100
  naturalHeight = 100
  complete = false
  private _src = ''
  constructor() { imageCtorCount++ }
  get src() { return this._src }
  set src(v: string) {
    this._src = v
    queueMicrotask(() => {
      if (v.includes('fail')) {
        this.onerror?.(new Error('img load failed'))
      } else {
        this.complete = true
        this.onload?.()
      }
    })
  }
}
;(globalThis as any).Image = FakeImage as any

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as any

function makeWidget(name: string, value: any = '') {
  return { name, value, callback: vi.fn() }
}

function makeNode(widgets: any[] = []): any {
  return { id: 7, widgets, onConfigure: null as any, outputs: [], setDirtyCanvas: vi.fn() }
}

function makeState(image: string | null): StageState {
  const inputs: ResolvedInput[] = image == null
    ? [{ slot: 'image', type: 'COMFYTV_IMAGE', source: 'empty', content: null }]
    : [{ slot: 'image', type: 'COMFYTV_IMAGE', source: 'upstream', content: image }]
  return reactive({
    kind: 'image', variant: 'transform',
    outputType: 'COMFYTV_IMAGES',
    output: null, outputs: [null],
    running: false, inputs, mainPrompt: '',
  }) as StageState
}

describe('split math', () => {
  it('parseSplits reads JSON and drops invalid values', () => {
    expect(parseSplits('[0.25, 0.75]')).toEqual([0.25, 0.75])
    expect(parseSplits('[0, 1, -0.2, 1.2]')).toEqual([])
    expect(parseSplits('not json', DEFAULT_V_SPLITS)).toEqual([0.5])
    expect(parseSplits('', DEFAULT_H_SPLITS)).toEqual([])
  })

  it('serializeSplits round-trips sorted unique fractions', () => {
    expect(serializeSplits([0.7, 0.2, 0.2])).toBe('[0.2,0.7]')
  })

  it('edgesFromSplits always includes 0 and 1', () => {
    expect(edgesFromSplits([])).toEqual([0, 1])
    expect(edgesFromSplits([0.5])).toEqual([0, 0.5, 1])
  })

  it('clampSplit stays between neighbors with a min gap', () => {
    expect(clampSplit(0.5, 0, 1)).toBe(0.5)
    expect(clampSplit(0, 0, 1)).toBeCloseTo(MIN_SPLIT_GAP)
    expect(clampSplit(1, 0, 0.5)).toBeCloseTo(0.5 - MIN_SPLIT_GAP)
  })

  it('setSplitAt / removeSplitAt mutate by index', () => {
    expect(setSplitAt([0.25, 0.75], 0, 0.4)).toEqual([0.4, 0.75])
    expect(removeSplitAt([0.25, 0.75], 1)).toEqual([0.25])
    expect(removeSplitAt([0.5], 3)).toEqual([0.5])
  })

  it('insertInLargestGap splits the biggest empty span', () => {
    expect(insertInLargestGap([])).toEqual([0.5])
    expect(insertInLargestGap([0.5])).toEqual([0.25, 0.5])
  })

  it('insertInLargestGap returns null at the cap', () => {
    const full = Array.from({ length: MAX_SPLITS }, (_, i) => (i + 1) / (MAX_SPLITS + 1))
    expect(insertInLargestGap(full)).toBeNull()
  })

  it('cellsFromSplits with no lines is one full-image cell', () => {
    const cells = cellsFromSplits([], [], 100, 80)
    expect(cells).toHaveLength(1)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 80, label: 'R1C1' })
  })

  it('cellsFromSplits with a vertical 0.5 is two columns', () => {
    const cells = cellsFromSplits([0.5], [], 100, 80)
    expect(cells).toHaveLength(2)
    expect(cells[0].label).toBe('R1C1')
    expect(cells[1].label).toBe('R1C2')
    expect(cells[0].w + cells[1].w).toBe(100)
  })

  it('fractionAlongAxis maps pointer coords through the displayed rect', () => {
    const d = { w: 100, h: 50, ox: 10, oy: 20, scale: 1 }
    expect(fractionAlongAxis('v', 60, 0, { left: 0, top: 0 }, d)).toBe(0.5)
    expect(fractionAlongAxis('h', 0, 45, { left: 0, top: 0 }, d)).toBe(0.5)
  })

  it('splitDelta follows screen pixels so canvas zoom stays 1:1', () => {
    const drag = { axis: 'v' as const, index: 0, startT: 0.5, startClient: 100, span: 200 }
    expect(splitDelta(drag, 120, 0)).toBeCloseTo(0.6)
    expect(splitDelta({ ...drag, axis: 'h', startClient: 50, span: 100 }, 0, 60)).toBeCloseTo(0.6)
  })

  it('imageScreenRect uses the img box when present', () => {
    const img = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 80, height: 40 } as DOMRect) }
    expect(imageScreenRect(img, null, null)).toEqual({ left: 10, top: 20, width: 80, height: 40 })
  })

  it('imageScreenRect falls back through canvas zoom via client vs bounding size', () => {
    const el = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      clientWidth: 100,
      clientHeight: 100,
    } as HTMLElement
    const d = { w: 80, h: 80, ox: 10, oy: 10, scale: 0.8 }
    expect(imageScreenRect(null, el, d)).toEqual({
      left: 20, top: 20, width: 160, height: 160,
    })
  })

  it('splitBandStyle positions a vertical band on the displayed image', () => {
    const d = { w: 100, h: 50, ox: 10, oy: 20, scale: 1 }
    const style = splitBandStyle('v', d, 0.5, 4)
    expect(style.left).toBe('58px')
    expect(style.height).toBe('50px')
  })

  it('parseCellLabels keeps only 正左背右 and pads to cell count', () => {
    expect(parseCellLabels('["正","左"]', 4)).toEqual(['正', '左', '', ''])
    expect(parseCellLabels('["正","nope","背"]', 2)).toEqual(['正', ''])
    expect(parseCellLabels('not json', 3)).toEqual(['', '', ''])
    expect(serializeCellLabels(['正', '', '右'])).toBe('["正","","右"]')
  })

  it('assignFaceLabel is unique — later stamps steal the name', () => {
    expect(assignFaceLabel(['正', '', ''], 1, '正')).toEqual(['', '正', ''])
    expect(assignFaceLabel(['正', '左'], 0, '')).toEqual(['', '左'])
  })

  it('cycleFaceLabel walks 正 → 左 → 背 → 右 → empty', () => {
    let labels = ['', '']
    labels = cycleFaceLabel(labels, 0)
    expect(labels[0]).toBe('正')
    labels = cycleFaceLabel(labels, 0)
    expect(labels[0]).toBe('左')
    labels = cycleFaceLabel(labels, 0)
    expect(labels[0]).toBe('背')
    labels = cycleFaceLabel(labels, 0)
    expect(labels[0]).toBe('右')
    labels = cycleFaceLabel(labels, 0)
    expect(labels[0]).toBe('')
  })

  it('orderByFaceLabels sorts 正 左 背 右 then unlabeled spatial leftovers', () => {
    const items = [
      { label: 'R1C2' },
      { label: '右' },
      { label: '正' },
      { label: '背' },
      { label: '左' },
    ]
    expect(orderByFaceLabels(items, x => x.label).map(x => x.label)).toEqual([
      '正', '左', '背', '右', 'R1C2',
    ])
    expect(faceRank('正')).toBe(0)
    expect(FACE_LABELS).toEqual(['正', '左', '背', '右'])
  })

  it('cellOverlayStyle maps native cell box onto the displayed image', () => {
    const d = { w: 50, h: 40, ox: 10, oy: 20, scale: 0.5 }
    const style = cellOverlayStyle(
      { x: 50, y: 0, w: 50, h: 80, row: 0, col: 1, index: 2, label: 'R1C2' },
      d, 100, 80,
    )
    expect(style).toEqual({ left: '35px', top: '20px', width: '25px', height: '40px' })
  })

  it('ensureFaceLabels fills 正左背右 only when nothing is labeled', () => {
    expect(ensureFaceLabels(['', '', '', ''], 4)).toEqual(['正', '左', '背', '右'])
    expect(ensureFaceLabels(['', ''], 2)).toEqual(['正', '左'])
    expect(ensureFaceLabels(['', '', '', '', ''], 5)).toEqual(['正', '左', '背', '右', ''])
    expect(ensureFaceLabels(['', '左', '', ''], 4)).toEqual(['', '左', '', ''])
  })

  it('syncCustomSplitOutputs keeps images batch then names tiles', () => {
    const node: any = { outputs: [], setDirtyCanvas: vi.fn() }
    syncCustomSplitOutputs(node, [
      { label: '正', image_url: '/a' },
      { label: '左', image_url: '/b' },
    ])
    expect(node.outputs[0]).toMatchObject({ name: 'images', type: 'COMFYTV_IMAGES' })
    expect(node.outputs[1]).toMatchObject({ name: '正', type: 'COMFYTV_IMAGE' })
    expect(node.outputs[2]).toMatchObject({ name: '左', type: 'COMFYTV_IMAGE' })
    expect(findCustomSplitTileSlot(node, '正')).toBe(1)
    expect(findModel3DFaceSlot({
      inputs: [{ name: 'images.正' }, { name: 'images.左' }],
    }, '左')).toBe(1)
  })
})

describe('useCustomSplit — state + widget bridging', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('seeds splits from widget values', () => {
    const node = makeNode([
      makeWidget('v_splits', '[0.3]'),
      makeWidget('h_splits', '[0.4,0.8]'),
    ])
    const { vSplits, hSplits } = useCustomSplit(node, makeState('/u'))
    expect(vSplits.value).toEqual([0.3])
    expect(hSplits.value).toEqual([0.4, 0.8])
  })

  it('falls back to one vertical 0.5 when widgets are missing', () => {
    const { vSplits, hSplits } = useCustomSplit(makeNode(), makeState('/u'))
    expect(vSplits.value).toEqual(DEFAULT_V_SPLITS)
    expect(hSplits.value).toEqual(DEFAULT_H_SPLITS)
  })

  it('addV inserts in the largest gap and writes the widget', async () => {
    const w = makeWidget('v_splits', '[0.5]')
    const node = makeNode([w, makeWidget('h_splits', '[]')])
    const { addV, vSplits } = useCustomSplit(node, makeState('/u'))
    addV()
    expect(vSplits.value).toEqual([0.25, 0.5])
    await nextTick()
    expect(w.value).toBe('[0.25,0.5]')
  })

  it('removeSelected drops the selected split', () => {
    const node = makeNode([
      makeWidget('v_splits', '[0.25,0.5]'),
      makeWidget('h_splits', '[]'),
    ])
    const { selectSplit, removeSelected, vSplits } = useCustomSplit(node, makeState('/u'))
    selectSplit('v', 0)
    removeSelected()
    expect(vSplits.value).toEqual([0.5])
  })

  it('onConfigure re-reads widget values', () => {
    const wv = makeWidget('v_splits', '[0.5]')
    const node = makeNode([wv, makeWidget('h_splits', '[]')])
    const { vSplits } = useCustomSplit(node, makeState('/u'))
    wv.value = '[0.2,0.8]'
    node.onConfigure?.({})
    expect(vSplits.value).toEqual([0.2, 0.8])
  })

  it('line drag uses screen-pixel deltas instead of layout fractions', () => {
    const node = makeNode([
      makeWidget('v_splits', '[0.5]'),
      makeWidget('h_splits', '[]'),
    ])
    const { vSplits, beginLineDrag, moveLineDrag, endLineDrag } = useCustomSplit(node, makeState('/u'))
    beginLineDrag('v', 0, 100, 0, { left: 0, top: 0, width: 200, height: 200 })
    moveLineDrag(120, 0)
    expect(vSplits.value[0]).toBeCloseTo(0.6)
    endLineDrag()
  })
})

describe('useCustomSplit — async run()/schedule()', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    imageCtorCount = 0
    ;(uploadCanvas as any).mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounced schedule splits into (h+1)*(v+1) cells', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    const node = makeNode([
      makeWidget('v_splits', '[0.5]'),
      makeWidget('h_splits', '[0.5]'),
    ])
    useCustomSplit(node, makeState('/img.png'))

    await vi.advanceTimersByTimeAsync(300)

    expect(spy).toHaveBeenCalledTimes(1)
    const [, msg] = spy.mock.calls[0]!
    const parsed = JSON.parse((msg as any).output[0])
    expect(parsed.images).toHaveLength(4)
    expect(parsed.images[0].label).toBe('R1C1')
    expect(parsed.images[3].label).toBe('R2C2')
    expect(uploadCanvas).toHaveBeenCalledTimes(4)
  })

  it('stamps unique face names and emits 正 左 背 右 order', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    const labels = makeWidget('cell_labels', '[]')
    const node = makeNode([
      makeWidget('v_splits', '[0.5]'),
      makeWidget('h_splits', '[0.5]'),
      labels,
    ])
    const { toggleAnnotating, stampCell, selectedFace, cellLabels } = useCustomSplit(
      node,
      makeState('/img.png'),
    )
    toggleAnnotating()
    selectedFace.value = '右'
    stampCell(0)
    selectedFace.value = '正'
    stampCell(1)
    selectedFace.value = '左'
    stampCell(2)
    selectedFace.value = '背'
    stampCell(3)
    expect(cellLabels.value).toEqual(['右', '正', '左', '背'])
    await nextTick()
    expect(labels.value).toBe('["右","正","左","背"]')

    await vi.advanceTimersByTimeAsync(300)
    const parsed = JSON.parse((spy.mock.calls.at(-1)![1] as any).output[0])
    expect(parsed.images.map((im: any) => im.label)).toEqual(['正', '左', '背', '右'])
    expect(parsed.images.map((im: any) => im.index)).toEqual(['1', '2', '3', '4'])
    expect(node.outputs.map((o: any) => o.name)).toEqual(['images', '正', '左', '背', '右'])
  })

  it('empty split lines yield a single full-image tile', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    const node = makeNode([
      makeWidget('v_splits', '[]'),
      makeWidget('h_splits', '[]'),
    ])
    useCustomSplit(node, makeState('/img.png'))
    await vi.advanceTimersByTimeAsync(300)
    const parsed = JSON.parse((spy.mock.calls[0]![1] as any).output[0])
    expect(parsed.images).toHaveLength(1)
    expect(parsed.images[0].label).toBe('R1C1')
  })

  it('does nothing when there is no upstream image', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    useCustomSplit(makeNode([
      makeWidget('v_splits', '[0.5]'),
      makeWidget('h_splits', '[]'),
    ]), makeState(null))
    await vi.advanceTimersByTimeAsync(300)
    expect(spy).not.toHaveBeenCalled()
    expect(imageCtorCount).toBe(0)
  })

  it('debounces rapid addV into a single run', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    const { addV } = useCustomSplit(makeNode([
      makeWidget('v_splits', '[0.5]'),
      makeWidget('h_splits', '[]'),
    ]), makeState('/img.png'))
    addV()
    addV()
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
