import { describe, expect, it, vi } from 'vitest'

import type { GroupData, RasterData, SceneNode } from '@jtydhr88/pentrado'

import {
  clipBaseOf,
  collectClipMaskSources,
  collectRasters,
  compositeSubtree,
  defaultCollapsedIds,
  findSceneNode,
  fitCompositeSize,
  flattenPsdTree,
  isolateSelected,
  isolateSubtree,
  isMemoryError,
  MAX_COMPOSITE_DIM,
  cropToBounds,
  cropCanvas,
  mapBounds,
  opaqueBounds,
  parseSelectedIds,
  PSD_ROOT_ID,
  rangeSelectIds,
  sceneFromPsdLayers,
  serializeSelectedIds,
  shouldAutoComposite,
  visibleTreeRows,
} from './psdLayerTree'

const LOCKS = { content: false, position: false, visibility: false }
const MODE = { blend: 'normal' } as RasterData['mode']

function raster(over: Partial<RasterData> & { id: string; name: string }): RasterData {
  return {
    kind: 'raster',
    visible: true,
    opacity: 1,
    mode: MODE,
    transform: { x: 0, y: 0, w: 8, h: 8, rotation: 0 },
    locks: LOCKS,
    contentId: `c-${over.id}`,
    naturalWidth: 8,
    naturalHeight: 8,
    ...over,
  }
}

function group(over: Partial<GroupData> & { id: string; name: string; children: SceneNode[] }): GroupData {
  return {
    kind: 'group',
    visible: true,
    opacity: 1,
    mode: MODE,
    transform: { x: 0, y: 0, w: 8, h: 8, rotation: 0 },
    locks: LOCKS,
    passThrough: false,
    ...over,
  }
}

describe('flattenPsdTree', () => {
  it('always includes a document root then nested rows', () => {
    const a = raster({ id: 'a', name: 'A' })
    const inner = raster({ id: 'b', name: 'B' })
    const g = group({ id: 'g', name: 'Folder', children: [inner] })
    const rows = flattenPsdTree([a, g], 'Doc')
    expect(rows[0]).toMatchObject({ id: PSD_ROOT_ID, name: 'Doc', kind: 'document', depth: 0 })
    expect(rows.map(r => r.id)).toEqual([PSD_ROOT_ID, 'a', 'g', 'b'])
    expect(rows.find(r => r.id === 'g')?.hasChildren).toBe(true)
    expect(rows.find(r => r.id === 'b')?.depth).toBe(2)
  })

  it('marks text/adjustment rows as warnings', () => {
    const text = {
      kind: 'text', id: 't', name: 'Title', visible: true, opacity: 1, mode: MODE,
      transform: { x: 0, y: 0, w: 1, h: 1, rotation: 0 }, locks: LOCKS,
      text: 'hi', fontRef: { kind: 'builtin', id: 'inter' }, fontSize: 12,
      color: '#fff', letterSpacing: 0, lineHeight: 1, align: 'left',
    } as SceneNode
    const rows = flattenPsdTree([text])
    expect(rows.find(r => r.id === 't')?.warning).toBe(true)
  })
})

describe('visibleTreeRows / isolateSubtree', () => {
  it('hides children of collapsed groups', () => {
    const inner = raster({ id: 'b', name: 'B' })
    const g = group({ id: 'g', name: 'Folder', children: [inner] })
    const rows = flattenPsdTree([g])
    const vis = visibleTreeRows(rows, new Set(['g']))
    expect(vis.map(r => r.id)).toEqual([PSD_ROOT_ID, 'g'])
  })

  it('defaults every folder closed, including the document root', () => {
    const inner = raster({ id: 'b', name: 'B' })
    const g = group({ id: 'g', name: 'Folder', children: [inner] })
    const rows = flattenPsdTree([g])
    const collapsed = defaultCollapsedIds(rows)
    expect([...collapsed]).toEqual(expect.arrayContaining([PSD_ROOT_ID, 'g']))
    expect(visibleTreeRows(rows, collapsed).map(r => r.id)).toEqual([PSD_ROOT_ID])
  })

  it('isolateSubtree of root returns the whole forest', () => {
    const a = raster({ id: 'a', name: 'A' })
    expect(isolateSubtree([a], PSD_ROOT_ID)).toEqual([a])
  })

  it('isolateSubtree of a group returns only that node', () => {
    const a = raster({ id: 'a', name: 'A' })
    const inner = raster({ id: 'b', name: 'B' })
    const g = group({ id: 'g', name: 'Folder', children: [inner] })
    expect(isolateSubtree([a, g], 'g')).toEqual([g])
    expect(findSceneNode([a, g], 'b')?.name).toBe('B')
  })

  it('missing id yields an empty isolate', () => {
    expect(isolateSubtree([raster({ id: 'a', name: 'A' })], 'nope')).toEqual([])
  })
})

describe('parseSelectedIds / serializeSelectedIds', () => {
  it('keeps a single id as a plain string for old workflows', () => {
    expect(parseSelectedIds('L3')).toEqual(['L3'])
    expect(serializeSelectedIds(['L3'])).toBe('L3')
    expect(serializeSelectedIds([])).toBe('')
    expect(parseSelectedIds('')).toEqual([])
  })

  it('round-trips a JSON array and drops duplicates', () => {
    expect(parseSelectedIds('["L0","L2","L0"]')).toEqual(['L0', 'L2'])
    expect(serializeSelectedIds(['L0', 'L2'])).toBe('["L0","L2"]')
  })
})

describe('rangeSelectIds / isolateSelected', () => {
  it('takes the inclusive visible range', () => {
    expect(rangeSelectIds(['__root__', 'a', 'g', 'b'], 'a', 'b')).toEqual(['a', 'g', 'b'])
    expect(rangeSelectIds(['a', 'b'], 'missing', 'b')).toEqual(['b'])
  })

  it('keeps sibling subtrees in document order', () => {
    const a = raster({ id: 'a', name: 'A' })
    const b = raster({ id: 'b', name: 'B' })
    const c = raster({ id: 'c', name: 'C' })
    expect(isolateSelected([a, b, c], ['c', 'a']).map(n => n.id)).toEqual(['a', 'c'])
  })

  it('drops a child when its group is also selected', () => {
    const inner = raster({ id: 'b', name: 'B' })
    const g = group({ id: 'g', name: 'Folder', children: [inner] })
    const a = raster({ id: 'a', name: 'A' })
    expect(isolateSelected([a, g], ['g', 'b', 'a']).map(n => n.id)).toEqual(['a', 'g'])
  })

  it('root selection wins over extra ids', () => {
    const a = raster({ id: 'a', name: 'A' })
    expect(isolateSelected([a], [PSD_ROOT_ID, 'a'])).toEqual([a])
  })
})

describe('compositeSubtree', () => {
  it('canvas size matches the document even with no layers', () => {
    const c = compositeSubtree(120, 80, [], new Map())
    expect(c.width).toBe(120)
    expect(c.height).toBe(80)
  })

  it('isolated subtree still composites at document size', () => {
    const leaf = raster({ id: 'a', name: 'A' })
    const isolated = isolateSubtree([leaf], 'a')
    const c = compositeSubtree(64, 48, isolated, new Map())
    expect(c.width).toBe(64)
    expect(c.height).toBe(48)
  })

  it('skips hidden rasters', () => {
    const draws: unknown[][] = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: (...args: unknown[]) => draws.push(args),
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
      }
    }) as any
    try {
      const hidden = raster({ id: 'h', name: 'H', visible: false, contentId: 'ch' })
      const shown = raster({ id: 's', name: 'S', visible: true, contentId: 'cs' })
      const contents = new Map<string, HTMLCanvasElement>([
        ['ch', { width: 8, height: 8 } as HTMLCanvasElement],
        ['cs', { width: 8, height: 8 } as HTMLCanvasElement],
      ])
      compositeSubtree(32, 32, [hidden, shown], contents, true)
      const srcs = draws.map(a => a[0])
      expect(srcs).toContain(contents.get('cs'))
      expect(srcs).not.toContain(contents.get('ch'))
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})

describe('opaqueBounds / cropToBounds', () => {
  function fakeCanvas(w: number, h: number, data: Uint8ClampedArray) {
    return {
      width: w,
      height: h,
      getContext: () => ({
        getImageData: () => ({ data, width: w, height: h }),
        drawImage: vi.fn(),
      }),
    } as unknown as HTMLCanvasElement
  }

  function rgba(w: number, h: number, fill: (x: number, y: number, px: Uint8ClampedArray, i: number) => void) {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) fill(x, y, data, (y * w + x) * 4)
    }
    return data
  }

  it('returns null when every pixel is transparent', () => {
    const data = new Uint8ClampedArray(4 * 3 * 4)
    expect(opaqueBounds(fakeCanvas(4, 3, data))).toBeNull()
  })

  it('finds the union of used pixels, not each blob separately', () => {
    const data = rgba(8, 6, (x, y, px, i) => {
      if ((x === 1 && y === 1) || (x === 6 && y === 4)) px[i + 3] = 255
    })
    expect(opaqueBounds(fakeCanvas(8, 6, data))).toEqual({ x: 1, y: 1, w: 6, h: 4 })
  })

  it('leaves a fully opaque canvas uncropped', () => {
    const src = document.createElement('canvas')
    src.width = 12
    src.height = 8
    const full = { x: 0, y: 0, w: 12, h: 8 }
    expect(cropToBounds(src, full)).toBe(src)
    expect(src.width).toBe(12)
  })

  it('crops two layers with the same union box so they stay aligned', () => {
    const union = { x: 2, y: 3, w: 10, h: 6 }
    const a = document.createElement('canvas')
    a.width = 20
    a.height = 16
    const b = document.createElement('canvas')
    b.width = 20
    b.height = 16
    const ca = cropToBounds(a, union)
    const cb = cropToBounds(b, union)
    expect(ca.width).toBe(10)
    expect(ca.height).toBe(6)
    expect(cb.width).toBe(10)
    expect(cb.height).toBe(6)
    expect(a.width).toBe(0)
    expect(b.width).toBe(0)
  })

  it('maps the union box when a later cell is a different size', () => {
    expect(mapBounds({ x: 10, y: 4, w: 20, h: 8 }, 40, 16, 20, 8)).toEqual({
      x: 5, y: 2, w: 10, h: 4,
    })
  })

  it('cropCanvas writes the requested size', () => {
    const src = document.createElement('canvas')
    src.width = 16
    src.height = 16
    const out = cropCanvas(src, { x: 4, y: 4, w: 5, h: 3 })
    expect(out.width).toBe(5)
    expect(out.height).toBe(3)
  })
})

describe('fitCompositeSize / memory', () => {
  it('leaves small documents unchanged', () => {
    expect(fitCompositeSize(120, 80)).toEqual({ width: 120, height: 80, scale: 1 })
  })

  it(`caps the long edge at ${MAX_COMPOSITE_DIM}`, () => {
    const fit = fitCompositeSize(8192, 4096)
    expect(fit.width).toBe(MAX_COMPOSITE_DIM)
    expect(fit.height).toBe(MAX_COMPOSITE_DIM / 2)
    expect(fit.scale).toBeCloseTo(0.5)
  })

  it('detects Chrome canvas memory errors', () => {
    expect(isMemoryError(new Error('exceeded memory limit'))).toBe(true)
    expect(isMemoryError(new Error('The requested image size exceeds the maximum canvas size'))).toBe(true)
    expect(isMemoryError(new Error('parse failed'))).toBe(false)
  })

  it('does not allocate a document-sized scratch per unmasked raster', () => {
    const orig = document.createElement.bind(document)
    let canvases = 0
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, opts?: any) => {
      if (tag === 'canvas') canvases++
      return orig(tag, opts)
    }) as typeof document.createElement)
    try {
      compositeSubtree(256, 256, [
        raster({ id: 'a', name: 'A' }),
        raster({ id: 'b', name: 'B' }),
      ], new Map([
        ['c-a', { width: 8, height: 8 } as HTMLCanvasElement],
        ['c-b', { width: 8, height: 8 } as HTMLCanvasElement],
      ]))
      expect(canvases).toBe(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('clipping masks', () => {
  it('maps ag-psd clipping onto scene nodes and tree rows', () => {
    const { nodes } = sceneFromPsdLayers([
      { name: 'Base', left: 0, top: 0, right: 8, bottom: 8 },
      { name: 'Clip', left: 0, top: 0, right: 8, bottom: 8, clipping: true },
    ])
    expect(nodes[0].clip).toBeUndefined()
    expect(nodes[1].clip).toBe(true)
    const rows = flattenPsdTree(nodes)
    expect(rows.find(r => r.name === 'Clip')?.clip).toBe(true)
    expect(rows.find(r => r.name === 'Base')?.clip).toBe(false)
    expect(clipBaseOf(nodes, nodes[1].id)?.id).toBe(nodes[0].id)
  })

  it('keeps hidden clip bases as extra decode sources when isolating the clipped layer', () => {
    const base = raster({ id: 'base', name: 'Base', visible: false })
    const clip = raster({ id: 'clip', name: 'Clip', clip: true })
    const extra = collectClipMaskSources([base, clip], [clip])
    expect(extra.map(n => n.id)).toEqual(['base'])
  })

  it('masks the clip group with destination-in then composites with the base blend', () => {
    const ops: string[] = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      let gco = 'source-over'
      return {
        canvas: this,
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        globalAlpha: 1,
        get globalCompositeOperation() { return gco },
        set globalCompositeOperation(v: string) { gco = v; ops.push(v) },
      }
    }) as any
    try {
      const base = raster({
        id: 'base',
        name: 'Base',
        mode: { blend: 'multiply' } as RasterData['mode'],
        contentId: 'c-base',
      })
      const clip = raster({
        id: 'clip',
        name: 'Clip',
        clip: true,
        mode: { blend: 'screen' } as RasterData['mode'],
        contentId: 'c-clip',
      })
      compositeSubtree(8, 8, [base, clip], new Map([
        ['c-base', { width: 4, height: 4 } as HTMLCanvasElement],
        ['c-clip', { width: 4, height: 4 } as HTMLCanvasElement],
      ]))
      expect(ops).toContain('destination-in')
      expect(ops).toContain('multiply')
      expect(ops).toContain('screen')
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})

describe('sceneFromPsdLayers', () => {
  it('builds a group tree without needing pixel canvases', () => {
    const { nodes, layerMap } = sceneFromPsdLayers([
      { name: 'Photo', left: 10, top: 20, right: 110, bottom: 80 },
      {
        name: 'Folder',
        blendMode: 'pass through',
        children: [
          { name: 'Inner', left: 0, top: 0, right: 8, bottom: 8, hidden: true },
          { name: 'Title', text: { text: 'hi' }, left: 0, top: 0, right: 4, bottom: 4 },
        ],
      },
    ])
    expect(nodes.map(n => n.kind)).toEqual(['raster', 'group'])
    expect(collectRasters(nodes).map(r => r.name)).toEqual(['Photo', 'Inner'])
    expect(layerMap.get('L0')?.name).toBe('Photo')
    const g = nodes[1] as { passThrough: boolean; children: { kind: string }[] }
    expect(g.passThrough).toBe(true)
    expect(g.children.map(c => c.kind)).toEqual(['raster', 'text'])
  })

  it('auto-composites small documents only', () => {
    expect(shouldAutoComposite(32, 24, 1)).toBe(true)
    expect(shouldAutoComposite(8000, 6000, 1)).toBe(false)
    expect(shouldAutoComposite(512, 512, 40)).toBe(false)
  })
})
