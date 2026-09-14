import { describe, expect, it, vi } from 'vitest'

import {
  collectMergeUrls,
  collectMergeUrlsFromSources,
  countLinkedMergeSlots,
  ensureMergeImageSockets,
  findMergeImageSlot,
  layoutImagesRow,
  mergeImages,
  parseAutogrowImageIndex,
  parseMergeMode,
  uniqueSlotIndexes,
} from './imageMerge'

describe('parseMergeMode', () => {
  it('defaults to layers', () => {
    expect(parseMergeMode(undefined)).toBe('layers')
    expect(parseMergeMode('layers')).toBe('layers')
    expect(parseMergeMode('other')).toBe('layers')
  })

  it('accepts row', () => {
    expect(parseMergeMode('row')).toBe('row')
  })
})

describe('collectMergeUrls', () => {
  it('reads autogrow slots in index order and skips empties', () => {
    expect(collectMergeUrls([
      { slot: 'images.image2', content: '/c.png' },
      { slot: 'images.image0', content: '/a.png' },
      { slot: 'images.image1', content: '' },
      { slot: 'image', content: '/ignore.png' },
    ])).toEqual(['/a.png', '/c.png'])
  })

  it('ignores the autogrow group socket so N wires are not collapsed onto image0', () => {
    expect(collectMergeUrls([
      { slot: 'images', content: '/a.png' },
      { slot: 'images.image1', content: '/b.png' },
      { slot: 'images.image2', content: '/c.png' },
    ])).toEqual(['/b.png', '/c.png'])
  })

  it('does not treat the group socket as image0', () => {
    expect(collectMergeUrls([
      { slot: 'images', content: '/a.png' },
      { slot: 'images.image0', content: '/b.png' },
      { slot: 'images.image1', content: '/c.png' },
    ])).toEqual(['/b.png', '/c.png'])
  })

  it('accepts bare imageN socket names', () => {
    expect(collectMergeUrls([
      { slot: 'image0', content: '/a.png' },
      { slot: 'image1', content: '/b.png' },
    ])).toEqual(['/a.png', '/b.png'])
  })

  it('counts each linked numbered socket and ignores the group', () => {
    expect(countLinkedMergeSlots([
      { name: 'images', link: 1 },
      { name: 'images.image0', link: 2 },
      { name: 'images.image1', link: 3 },
      { name: 'images.image2', link: null },
    ])).toBe(2)
  })

  it('unwraps batch JSON payloads', () => {
    expect(collectMergeUrls([
      { slot: 'images.image0', content: JSON.stringify({ images: [{ image_url: '/batch.png' }] }) },
    ])).toEqual(['/batch.png'])
  })

  it('returns empty for missing inputs', () => {
    expect(collectMergeUrls(null)).toEqual([])
    expect(collectMergeUrls([])).toEqual([])
  })

  it('fills missing state payloads from live graph links', () => {
    expect(collectMergeUrlsFromSources({
      inputs: [{ slot: 'images.image0', content: null, source: 'upstream-pending' }],
      nodeInputs: [
        { name: 'images', link: 9 },
        { name: 'images.image0', link: 1 },
        { name: 'images.image1', link: 2 },
      ],
      resolveLink: (id) => id === 1 ? '/a.png' : id === 2 ? '/b.png' : '/nope.png',
    })).toEqual(['/a.png', '/b.png'])
  })
})

describe('parseAutogrowImageIndex', () => {
  it('rejects the autogrow group name', () => {
    expect(parseAutogrowImageIndex('images')).toBeNull()
    expect(parseAutogrowImageIndex('images.image0')).toBe(0)
    expect(parseAutogrowImageIndex('image2')).toBe(2)
  })
})

describe('findMergeImageSlot / ensureMergeImageSockets', () => {
  it('prefers numbered image sockets over the autogrow group', () => {
    const node = {
      inputs: [
        { name: 'images', type: 'COMFY_AUTOGROW_V3', link: null },
        { name: 'images.image0', type: 'COMFY_AUTOGROW_V3', link: 4 },
        { name: 'image1', type: '', link: null },
      ],
    }
    expect(findMergeImageSlot(node, 0)).toBe(1)
    expect(findMergeImageSlot(node, 1)).toBe(2)
    const links = new Map([[4, { type: 'COMFY_AUTOGROW_V3' }]])
    ensureMergeImageSockets(node, { links })
    expect(node.inputs[0].type).toBe('COMFY_AUTOGROW_V3')
    expect(node.inputs[1].type).toBe('COMFYTV_IMAGE')
    expect(node.inputs[2].type).toBe('COMFYTV_IMAGE')
    expect(links.get(4)?.type).toBe('COMFYTV_IMAGE')
  })
})

describe('uniqueSlotIndexes', () => {
  it('keeps first-occurrence order', () => {
    expect(uniqueSlotIndexes([2, 0, 2, 1, -1])).toEqual([2, 0, 1])
  })
})

describe('layoutImagesRow', () => {
  it('places images left to right on a union-height canvas', () => {
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
      const out = layoutImagesRow([a, b])
      expect(out.width).toBe(14)
      expect(out.height).toBe(8)
      expect(draws).toEqual([[a, 0, 0], [b, 4, 0]])
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})

describe('mergeImages', () => {
  it('stacks like layers in layers mode', () => {
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
      const out = mergeImages([a, b], 'layers')
      expect(out.width).toBe(10)
      expect(out.height).toBe(8)
      expect(draws.map(d => d[0])).toEqual([a, b])
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})
