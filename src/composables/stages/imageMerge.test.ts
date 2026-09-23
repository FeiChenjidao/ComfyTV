import { describe, expect, it, vi } from 'vitest'

import {
  collectMergeUrls,
  collectMergeUrlsFromSources,
  containFitSquare,
  countLinkedMergeSlots,
  ensureMergeImageSockets,
  findMergeImageSlot,
  layoutImagesRow,
  mergeImages,
  padCanvasToSquare,
  parseAutogrowImageIndex,
  parseMergeAspect,
  parseMergeMode,
  pruneMergeEmptyInputs,
  restoreMergeInputsFromSaved,
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

describe('parseMergeAspect', () => {
  it('defaults to native', () => {
    expect(parseMergeAspect(undefined)).toBe('native')
    expect(parseMergeAspect('native')).toBe('native')
    expect(parseMergeAspect('other')).toBe('native')
  })

  it('accepts 1:1', () => {
    expect(parseMergeAspect('1:1')).toBe('1:1')
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

describe('restoreMergeInputsFromSaved', () => {
  it('reattaches images.imageN links after expanding short Autogrow lists', () => {
    const links = new Map<number, any>([
      [1, { id: 1, target_id: 9, target_slot: 0, type: '' }],
      [2, { id: 2, target_id: 9, target_slot: 0, type: '' }],
      [3, { id: 3, target_id: 9, target_slot: 0, type: '' }],
    ])
    const node: any = {
      id: 9,
      graph: { links },
      inputs: [
        { name: 'images', type: 'COMFY_AUTOGROW_V3', link: null },
        { name: 'images.image0', type: 'COMFYTV_IMAGE', link: null },
      ],
      addInput: (name: string, type: string) => {
        node.inputs.push({ name, type, link: null })
      },
    }
    restoreMergeInputsFromSaved(node, {
      inputs: [
        { name: 'images.image0', link: 1 },
        { name: 'images.image1', link: 2 },
        { name: 'images.image2', link: 3 },
      ],
    })
    expect(findMergeImageSlot(node, 0)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 1)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 2)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 3)).toBeGreaterThanOrEqual(0) // spare
    const s0 = findMergeImageSlot(node, 0)
    const s1 = findMergeImageSlot(node, 1)
    const s2 = findMergeImageSlot(node, 2)
    expect(node.inputs[s0].link).toBe(1)
    expect(node.inputs[s1].link).toBe(2)
    expect(node.inputs[s2].link).toBe(3)
    expect(links.get(1)?.target_slot).toBe(s0)
    expect(links.get(2)?.target_slot).toBe(s1)
    expect(links.get(3)?.target_slot).toBe(s2)
  })

  it('creates missing numbered slots before restoring links', () => {
    const node: any = {
      id: 1,
      graph: { links: {} },
      inputs: [
        { name: 'images.image0', type: 'COMFYTV_IMAGE', link: null },
      ],
      addInput: (name: string, type: string) => {
        node.inputs.push({ name, type, link: null })
      },
    }
    restoreMergeInputsFromSaved(node, {
      inputs: [
        { name: 'images.image0', link: 1 },
        { name: 'images.image1', link: 2 },
        { name: 'images.image2', link: 3 },
      ],
    })
    expect(findMergeImageSlot(node, 0)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 1)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 2)).toBeGreaterThanOrEqual(0)
  })

  it('does not reopen empty image0…31 from old fixed-schema saves', () => {
    const saved = Array.from({ length: 32 }, (_, i) => ({
      name: `image${i}`,
      link: i < 2 ? i + 1 : null,
    }))
    const node: any = {
      id: 3,
      graph: { links: {} },
      inputs: [
        { name: 'images', type: 'COMFY_AUTOGROW_V3', link: null },
        ...saved.map((s) => ({ name: s.name, type: 'COMFYTV_IMAGE', link: s.link })),
      ],
      addInput: (name: string, type: string) => {
        node.inputs.push({ name, type, link: null })
      },
      removeInput: (i: number) => {
        node.inputs.splice(i, 1)
      },
    }
    restoreMergeInputsFromSaved(node, { inputs: saved })
    const imageSlots = node.inputs.filter(
      (inp: any) => parseAutogrowImageIndex(String(inp.name || '')) != null,
    )
    // linked 0,1 + spare 2
    expect(imageSlots.length).toBe(3)
    expect(findMergeImageSlot(node, 0)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 1)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 2)).toBeGreaterThanOrEqual(0)
    expect(findMergeImageSlot(node, 3)).toBe(-1)
    expect(findMergeImageSlot(node, 31)).toBe(-1)
  })
})

describe('pruneMergeEmptyInputs', () => {
  it('keeps linked + one spare and drops higher empties', () => {
    const node: any = {
      inputs: [
        { name: 'images.image0', link: 1 },
        { name: 'images.image1', link: null },
        { name: 'images.image2', link: null },
        { name: 'images.image5', link: null },
      ],
      removeInput: (i: number) => {
        node.inputs.splice(i, 1)
      },
    }
    pruneMergeEmptyInputs(node, 1)
    expect(node.inputs.map((i: any) => i.name)).toEqual([
      'images.image0',
      'images.image1',
    ])
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

  it('pads layers composite to 1:1 on the long side', () => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        drawImage: () => {},
      }
    }) as any
    try {
      const a = { width: 10, height: 6 } as HTMLCanvasElement
      const out = mergeImages([a], 'layers', '1:1')
      expect(out.width).toBe(10)
      expect(out.height).toBe(10)
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })

  it('rows 1:1 squares into N:1', () => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        drawImage: () => {},
      }
    }) as any
    try {
      const a = { width: 8, height: 4 } as HTMLCanvasElement
      const b = { width: 6, height: 10 } as HTMLCanvasElement
      const out = mergeImages([a, b], 'row', '1:1')
      // cell = max(max(8,4), max(6,10)) = max(8, 10) = 10 → 20×10 = 2:1
      expect(out.width).toBe(20)
      expect(out.height).toBe(10)
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})

describe('containFitSquare / padCanvasToSquare', () => {
  it('contain-fits into the given side', () => {
    const draws: unknown[][] = []
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        drawImage: (...args: unknown[]) => draws.push(args),
      }
    }) as any
    try {
      const im = { width: 8, height: 4 } as HTMLCanvasElement
      const out = containFitSquare(im, 8)
      expect(out.width).toBe(8)
      expect(out.height).toBe(8)
      expect(draws[0]?.[3]).toBe(8)
      expect(draws[0]?.[4]).toBe(4)
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })

  it('pads a canvas out to the long side', () => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      return { canvas: this, drawImage: () => {} }
    }) as any
    try {
      const src = document.createElement('canvas')
      src.width = 10
      src.height = 4
      const out = padCanvasToSquare(src)
      expect(out.width).toBe(10)
      expect(out.height).toBe(10)
    } finally {
      HTMLCanvasElement.prototype.getContext = orig
    }
  })
})
