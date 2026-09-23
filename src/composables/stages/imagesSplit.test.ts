import { describe, expect, it, vi } from 'vitest'

import {
  IMAGES_SPLIT_MAX,
  compositeLayerImages,
  imagesSplitUrlAt,
  itemsInDocumentOrder,
  parseImageGroupItems,
  rangeSelectIndexes,
  splitImageGroup,
  syncImagesSplitOutputs,
  syncImagesSplitStage,
} from './imagesSplit'

describe('parseImageGroupItems', () => {
  it('reads labeled images from a pool JSON', () => {
    const items = parseImageGroupItems(JSON.stringify({
      images: [
        { index: '1', label: 'Sky', image_url: '/view?a.png' },
        { index: '2', name: 'Ground', image_url: '/view?b.png' },
      ],
    }))
    expect(items).toEqual([
      { index: '1', label: 'Sky', image_url: '/view?a.png' },
      { index: '2', label: 'Ground', image_url: '/view?b.png' },
    ])
  })

  it('wraps a bare image URL as one unnamed layer', () => {
    expect(parseImageGroupItems('/view?solo.png')).toEqual([
      { index: '1', label: 'Layer 1', image_url: '/view?solo.png' },
    ])
  })

  it('skips entries without a url', () => {
    const items = parseImageGroupItems(JSON.stringify({
      images: [{ label: 'Empty' }, { image_url: '/view?ok.png', label: 'Ok' }],
    }))
    expect(items).toEqual([{ index: '1', label: 'Ok', image_url: '/view?ok.png' }])
  })

  it('returns empty for missing or invalid JSON objects', () => {
    expect(parseImageGroupItems(null)).toEqual([])
    expect(parseImageGroupItems('')).toEqual([])
    expect(parseImageGroupItems('{}')).toEqual([])
  })
})

describe('syncImagesSplitOutputs', () => {
  function makeNode(count = 4) {
    const node: any = {
      outputs: Array.from({ length: count }, (_, i) => ({
        name: `image${i + 1}`,
        type: 'COMFYTV_IMAGE',
        links: [],
      })),
      addOutput: (name: string, type: string, extra?: Record<string, string>) => {
        node.outputs.push({ name, type, links: [], ...extra })
      },
      removeOutput: (i: number) => { node.outputs.splice(i, 1) },
      setDirtyCanvas: () => {},
    }
    return node
  }

  it('trims unlinked extra sockets down to the item count (minimum 1)', () => {
    const node = makeNode(8)
    syncImagesSplitOutputs(node, [
      { index: '1', label: 'A', image_url: '/a' },
      { index: '2', label: 'B', image_url: '/b' },
    ])
    expect(node.outputs.map((s: any) => s.name)).toEqual(['image1', 'image2'])
    expect(node.outputs.map((s: any) => s.label)).toEqual(['A', 'B'])
    expect(node.outputs.map((s: any) => s.localized_name)).toEqual(['A', 'B'])
  })

  it('keeps linked sockets when the group is temporarily empty', () => {
    const node = makeNode(4)
    node.outputs[0].links = [1]
    node.outputs[2].links = [2]
    syncImagesSplitOutputs(node, [])
    expect(node.outputs).toHaveLength(3)
    expect(node.outputs.map((s: any) => s.name)).toEqual(['image1', 'image2', 'image3'])
    expect(node.outputs[0].links).toEqual([1])
    expect(node.outputs[2].links).toEqual([2])
  })

  it('keeps one placeholder socket when the group is empty and unlinked', () => {
    const node = makeNode(4)
    syncImagesSplitOutputs(node, [])
    expect(node.outputs).toHaveLength(1)
    expect(node.outputs[0].name).toBe('image1')
    expect(node.outputs[0].label).toBe('image1')
  })

  it('grows sockets up to the cap', () => {
    const node = makeNode(1)
    const items = Array.from({ length: IMAGES_SPLIT_MAX + 4 }, (_, i) => ({
      index: String(i + 1),
      label: `L${i + 1}`,
      image_url: `/${i}`,
    }))
    syncImagesSplitOutputs(node, items.slice(0, IMAGES_SPLIT_MAX))
    expect(node.outputs).toHaveLength(IMAGES_SPLIT_MAX)
    expect(node.outputs[0].localized_name).toBe('L1')
    expect(node.outputs[0].name).toBe('image1')
    expect(node.outputs.at(-1).name).toBe(`image${IMAGES_SPLIT_MAX}`)
    expect(node.outputs.at(-1).localized_name).toBe(`L${IMAGES_SPLIT_MAX}`)
  })

  it('shrinks a socket-stretched node back to a compact height', () => {
    const node = makeNode(32)
    node.size = [280, 960]
    node.setSize = (v: [number, number]) => { node.size = v }
    syncImagesSplitOutputs(node, [
      { index: '1', label: 'A', image_url: '/a' },
    ])
    expect(node.size[1]).toBeLessThanOrEqual(800)
    expect(node.size[1]).toBeGreaterThanOrEqual(680)
  })

  it('grows a too-short card so layer thumbs have room', () => {
    const node = makeNode(2)
    node.size = [280, 280]
    node.setSize = (v: [number, number]) => { node.size = v }
    syncImagesSplitOutputs(node, [
      { index: '1', label: 'A', image_url: '/a' },
      { index: '2', label: 'B', image_url: '/b' },
    ])
    expect(node.size[1]).toBeGreaterThanOrEqual(680)
    expect(node.size[0]).toBeGreaterThanOrEqual(360)
  })

  it('keeps schema names and puts layer titles on labels', () => {
    const node = makeNode(1)
    syncImagesSplitOutputs(node, [
      { index: '1', label: '梅花', image_url: '/a' },
      { index: '2', label: '山石瀑布', image_url: '/b' },
    ])
    expect(node.outputs[0].name).toBe('image1')
    expect(node.outputs[0].label).toBe('梅花')
    expect(node.outputs[1].name).toBe('image2')
    expect(node.outputs[1].label).toBe('山石瀑布')
  })

  it('disambiguates duplicate layer names on labels only', () => {
    const node = makeNode(1)
    syncImagesSplitOutputs(node, [
      { index: '1', label: 'Layer', image_url: '/a' },
      { index: '2', label: 'Layer', image_url: '/b' },
    ])
    expect(node.outputs.map((s: any) => s.name)).toEqual(['image1', 'image2'])
    expect(node.outputs.map((s: any) => s.label)).toEqual(['Layer', 'Layer (2)'])
  })
})

describe('rangeSelectIndexes / itemsInDocumentOrder', () => {
  it('takes the inclusive index range', () => {
    expect(rangeSelectIndexes([0, 1, 2, 3], 1, 3)).toEqual([1, 2, 3])
    expect(rangeSelectIndexes([0, 1, 2], 9, 1)).toEqual([1])
  })

  it('keeps selected layers in document order, not click order', () => {
    const items = [
      { index: '1', label: 'A', image_url: '/a' },
      { index: '2', label: 'B', image_url: '/b' },
      { index: '3', label: 'C', image_url: '/c' },
    ]
    expect(itemsInDocumentOrder(items, [2, 0]).map(i => i.label)).toEqual(['A', 'C'])
  })
})

describe('compositeLayerImages', () => {
  it('unions the canvas size and draws back to front', () => {
    const draws: unknown[][] = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        drawImage: (...args: unknown[]) => draws.push(args),
      }
    }) as any
    try {
      const a = { width: 4, height: 8 } as HTMLCanvasElement
      const b = { width: 10, height: 6 } as HTMLCanvasElement
      const out = compositeLayerImages([a, b])
      expect(out.width).toBe(10)
      expect(out.height).toBe(8)
      expect(draws.map(d => d[0])).toEqual([a, b])
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})

describe('syncImagesSplitStage / imagesSplitUrlAt', () => {
  it('writes numbered snapshot slots and compact outputs', () => {
    const node = {
      outputs: Array.from({ length: 4 }, (_, i) => ({
        name: `image${i + 1}`, type: 'COMFYTV_IMAGE', links: [],
      })),
      removeOutput: (i: number) => { node.outputs.splice(i, 1) },
      setDirtyCanvas: () => {},
    }
    const written: Array<string | null>[] = []
    const { items, truncated } = syncImagesSplitStage(
      node,
      JSON.stringify({
        images: [
          { label: 'Sky', image_url: '/sky.png' },
          { label: 'Ground', image_url: '/g.png' },
        ],
      }),
      urls => written.push(urls),
    )
    expect(truncated).toBe(false)
    expect(items.map(i => i.label)).toEqual(['Sky', 'Ground'])
    expect(node.outputs.map((s: any) => s.name)).toEqual(['image1', 'image2'])
    expect(node.outputs.map((s: any) => s.label)).toEqual(['Sky', 'Ground'])
    expect(written[0]?.slice(0, 3)).toEqual(['/sky.png', '/g.png', null])
    expect(written[0]).toHaveLength(IMAGES_SPLIT_MAX)
  })

  it('reads a slot from outputs, then falls back to the incoming group', () => {
    expect(imagesSplitUrlAt({ outputs: ['/a', '/b'] }, 1)).toBe('/b')
    expect(imagesSplitUrlAt({
      outputs: [null],
      inputs: [{
        slot: 'images',
        content: JSON.stringify({
          images: [
            { image_url: '/a.png' },
            { image_url: '/b.png' },
          ],
        }),
      }],
    }, 1)).toBe('/b.png')
    expect(splitImageGroup(JSON.stringify({
      images: Array.from({ length: IMAGES_SPLIT_MAX + 1 }, (_, i) => ({ image_url: `/${i}` })),
    })).truncated).toBe(true)
  })
})
