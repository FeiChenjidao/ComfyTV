import { describe, expect, it } from 'vitest'

import {
  applyPositions,
  assetEntry,
  batchEntry,
  currentMediaTable,
  dropLegacyRefs,
  liveLinks,
  materializeMedia,
  MEDIA_PROP,
  moveEntry,
  nodeAcceptsMedia,
  positionOfLink,
  positionRemap,
  readMediaTable,
  reconcileTable,
  writeMediaTable,
} from './mediaOrder'

function node(inputs: Array<[string, number | null]>, properties: Record<string, unknown> = {}): any {
  return {
    inputs: inputs.map(([name, link]) => ({ name, link })),
    properties,
  }
}

const graph = {
  links: {
    11: { origin_id: 3, origin_slot: 0 },
    12: { origin_id: 4, origin_slot: 1 },
    13: { origin_id: 5, origin_slot: 0 },
  },
}

describe('readMediaTable / writeMediaTable', () => {
  it('returns an empty table for bare nodes and normalizes entries', () => {
    expect(readMediaTable(null)).toEqual({ image: [], video: [], audio: [] })
    const n = node([], { [MEDIA_PROP]: { image: [
      { src: 'link', link: 11, from: [3, 0] },
      { src: 'asset', asset_id: 7 },
      { src: 'batch', batch_id: 'b1', batch_index: 2 },
      { src: 'asset', asset_id: 7 },
      { src: 'bogus' },
    ] } })
    expect(readMediaTable(n).image.map(e => e.key)).toEqual(['l11', 'a7', 'bb1:2'])
  })

  it('round-trips through properties', () => {
    const n = node([])
    writeMediaTable(n, { image: [assetEntry(1)], video: [batchEntry('b', 0)], audio: [] })
    expect(n.properties[MEDIA_PROP]).toEqual({
      image: [{ src: 'asset', asset_id: 1 }],
      video: [{ src: 'batch', batch_id: 'b', batch_index: 0 }],
      audio: [],
    })
    expect(readMediaTable(n).video[0]!.key).toBe('bb:0')
  })
})

describe('liveLinks / nodeAcceptsMedia', () => {
  it('collects wired autogrow inputs in slot order with origins', () => {
    const n = node([['images.image2', 12], ['images.image0', 11], ['images.image1', null], ['texts.text0', 5]])
    expect(liveLinks(n, 'image', graph)).toEqual([
      { link: 11, slot: 0, inputName: 'images.image0', inputIndex: 1, from: [3, 0] },
      { link: 12, slot: 2, inputName: 'images.image2', inputIndex: 0, from: [4, 1] },
    ])
    expect(nodeAcceptsMedia(n, 'image')).toBe(true)
    expect(nodeAcceptsMedia(n, 'video')).toBe(false)
  })

  it('accepts bare imageN sockets used by merge autogrow labels', () => {
    const n = node([['image0', 11], ['image1', 12], ['images', 99]])
    expect(liveLinks(n, 'image', graph)).toEqual([
      { link: 11, slot: 0, inputName: 'image0', inputIndex: 0, from: [3, 0] },
      { link: 12, slot: 1, inputName: 'image1', inputIndex: 1, from: [4, 1] },
    ])
    expect(nodeAcceptsMedia(n, 'image')).toBe(true)
  })

  it('treats the plain audio input as slot 0', () => {
    const n = node([['audio', 13]])
    expect(liveLinks(n, 'audio', graph)[0]).toMatchObject({ link: 13, slot: 0 })
    expect(nodeAcceptsMedia(n, 'audio')).toBe(true)
  })

  it('treats plain image / image_a / image_b as strip sockets in input order', () => {
    const n = node([['image', 11]])
    expect(nodeAcceptsMedia(n, 'image')).toBe(true)
    expect(liveLinks(n, 'image', graph)).toEqual([
      { link: 11, slot: 0, inputName: 'image', inputIndex: 0, from: [3, 0] },
    ])

    // Fixed sockets get slots in declaration order (not name sort).
    const merge = node([['image_b', 12], ['image_a', 11]])
    expect(liveLinks(merge, 'image', graph).map(l => [l.inputName, l.slot])).toEqual([
      ['image_b', 0],
      ['image_a', 1],
    ])
  })

  it('ignores specialized image sockets like mask_image', () => {
    const n = node([['mask_image', 11], ['depth_image', 12]])
    expect(nodeAcceptsMedia(n, 'image')).toBe(false)
    expect(liveLinks(n, 'image', graph)).toEqual([])
  })

  it('treats Model3D TemplateNames face sockets as strip images', () => {
    const n = node([
      ['images.正', 11],
      ['images.左', null],
      ['images.背', 12],
      ['images.右', null],
      ['images.辅', 13],
    ])
    expect(nodeAcceptsMedia(n, 'image')).toBe(true)
    expect(liveLinks(n, 'image', graph)).toEqual([
      { link: 11, slot: 0, inputName: 'images.正', inputIndex: 0, from: [3, 0] },
      { link: 12, slot: 1, inputName: 'images.背', inputIndex: 2, from: [4, 1] },
      { link: 13, slot: 2, inputName: 'images.辅', inputIndex: 4, from: [5, 0] },
    ])
    const r = reconcileTable(n, graph)
    expect(r.table.image.map(e => e.key)).toEqual(['l11', 'l12', 'l13'])
  })
})

describe('reconcileTable', () => {
  it('builds a fresh table from live links in slot order', () => {
    const n = node([['images.image1', 12], ['images.image0', 11]])
    const r = reconcileTable(n, graph)
    expect(r.changed).toBe(true)
    expect(r.table.image.map(e => e.key)).toEqual(['l11', 'l12'])
    expect(r.table.image[0]!.from).toEqual([3, 0])
  })

  it('orders wires by socket slot, then keeps manual refs after', () => {
    const n = node([['images.image0', 11], ['images.image1', 12], ['images.image2', 13]])
    writeMediaTable(n, { image: [
      { key: 'l13', src: 'link', link: 13 }, { key: 'l11', src: 'link', link: 11 }, { key: 'l12', src: 'link', link: 12 },
    ], video: [], audio: [] })
    n.inputs = [{ name: 'images.image0', link: 12 }, { name: 'images.image1', link: 13 }]
    const r = reconcileTable(n, graph)
    expect(r.changed).toBe(true)
    expect(r.table.image.map(e => e.key)).toEqual(['l12', 'l13'])
  })

  it('puts every wired socket before manually added refs', () => {
    const n = node([['images.image0', 11]])
    writeMediaTable(n, { image: [assetEntry(7), { key: 'l11', src: 'link', link: 11 }], video: [], audio: [] })
    n.inputs.push({ name: 'images.image1', link: 12 })
    const r = reconcileTable(n, graph)
    expect(r.table.image.map(e => e.key)).toEqual(['l11', 'l12', 'a7'])
  })

  it('promotes a newly wired plain image ahead of existing asset refs', () => {
    const n = node([['image', 11]])
    writeMediaTable(n, { image: [assetEntry(7), assetEntry(8)], video: [], audio: [] })
    const r = reconcileTable(n, graph)
    expect(r.table.image.map(e => e.key)).toEqual(['l11', 'a7', 'a8'])
  })

  it('re-attaches an entry whose link id changed but origin matches', () => {
    const n = node([['images.image0', 13]])
    writeMediaTable(n, { image: [{ key: 'l99', src: 'link', link: 99, from: [5, 0] }, assetEntry(1)], video: [], audio: [] })
    const r = reconcileTable(n, graph)
    expect(r.table.image.map(e => e.key)).toEqual(['l13', 'a1'])
  })

  it('is stable when nothing changed', () => {
    const n = node([['images.image0', 11]])
    writeMediaTable(n, reconcileTable(n, graph).table)
    expect(reconcileTable(n, graph).changed).toBe(false)
  })

  it('migrates legacy refs: slots become positions, wire before ref at the same slot', () => {
    const n = node([['images.image0', 11], ['images.image2', 12]], {
      comfytv_image_refs: [
        { asset_id: 5, slot: 4 },
        { asset_id: 6, slot: 2 },
        { asset_id: 8, slot: 0, type: 'video' },
        { batch_id: 'b1', batch_index: 1, slot: 1 },
      ],
    })
    const r = reconcileTable(n, graph)
    expect(r.migrated).toBe(true)
    expect(r.table.image.map(e => e.key)).toEqual(['l11', 'bb1:1', 'l12', 'a6', 'a5'])
    expect(r.table.video.map(e => e.key)).toEqual(['a8'])
    expect([...r.remap.image!.entries()]).toEqual([[0, 1], [1, 2], [2, 3], [4, 5]])
    expect([...r.remap.video!.entries()]).toEqual([[0, 1]])
    expect(r.hadLegacy).toBe(true)
    expect(n.properties.comfytv_image_refs).toBeDefined()
    dropLegacyRefs(n)
    expect(n.properties.comfytv_image_refs).toBeUndefined()
  })

  it('fresh node without legacy refs reports no remap', () => {
    const r = reconcileTable(node([]), graph)
    expect(r.migrated).toBe(false)
    expect(r.hadLegacy).toBe(false)
    expect(r.remap).toEqual({})
  })

  it('currentMediaTable derives from live links before the first sync', () => {
    const n = node([['images.image0', 11]])
    expect(currentMediaTable(n, graph).image.map(e => e.key)).toEqual(['l11'])
    writeMediaTable(n, { image: [assetEntry(4)], video: [], audio: [] })
    expect(currentMediaTable(n, graph).image.map(e => e.key)).toEqual(['a4'])
  })
})

describe('positions helpers', () => {
  it('positionRemap only lists moved or removed positions', () => {
    const a = assetEntry(1), b = assetEntry(2), c = assetEntry(3)
    expect([...positionRemap([a, b, c], [c, a]).entries()]).toEqual([[1, 2], [2, null], [3, 1]])
    expect(positionRemap([a, b], [a, b]).size).toBe(0)
  })

  it('moveEntry and applyPositions reorder', () => {
    const list = [1, 2, 3, 4]
    expect(moveEntry(list, 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveEntry(list, 3, 0)).toEqual([4, 1, 2, 3])
    expect(applyPositions(list, [4, 1, 3, 2])).toEqual([4, 1, 3, 2])
    expect(() => applyPositions(list, [1, 1, 2, 3])).toThrow(/permutation/)
    expect(() => applyPositions(list, [1, 2])).toThrow(/expected 4/)
  })

  it('positionOfLink finds the 1-based position', () => {
    const table = { image: [assetEntry(1), { key: 'l5', src: 'link' as const, link: 5 }], video: [], audio: [] }
    expect(positionOfLink(table, 'image', 5)).toBe(2)
    expect(positionOfLink(table, 'image', 6)).toBeNull()
  })
})

describe('materializeMedia', () => {
  const urlOf = (e: any) => (e.src === 'asset' ? `/asset/${e.asset_id}` : e.src === 'batch' ? `/batch/${e.batch_index}` : null)

  it('re-emits autogrow keys contiguously in table order', () => {
    const n = node([['images.image0', 11], ['images.image1', 12]])
    const table = { image: [assetEntry(7), { key: 'l12', src: 'link' as const, link: 12 }, { key: 'l11', src: 'link' as const, link: 11 }], video: [], audio: [] }
    const inputs: Record<string, unknown> = { 'images.image0': ['3', 0], 'images.image1': ['4', 1], main_prompt: 'x' }
    const warnings = materializeMedia(inputs, n, table, urlOf)
    expect(warnings).toEqual([])
    expect(inputs).toEqual({
      'images.image0': '/asset/7',
      'images.image1': ['4', 1],
      'images.image2': ['3', 0],
      main_prompt: 'x',
    })
  })

  it('routes each type to its own namespace and honors the plain audio input', () => {
    const n = node([['images.image0', null], ['videos.video0', null], ['audio', 13]])
    const table = {
      image: [assetEntry(1)],
      video: [assetEntry(2), batchEntry('b', 3)],
      audio: [{ key: 'l13', src: 'link' as const, link: 13 }, assetEntry(4)],
    }
    const inputs: Record<string, unknown> = { audio: ['5', 0] }
    const warnings = materializeMedia(inputs, n, table, urlOf)
    expect(inputs).toEqual({
      'images.image0': '/asset/1',
      'videos.video0': '/asset/2',
      'videos.video1': '/batch/3',
      audio: ['5', 0],
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/1 audio input/)
  })

  it('writes plain image / image_a+b sockets from the strip in order', () => {
    const single = node([['image', null]])
    const inputs1: Record<string, unknown> = {}
    materializeMedia(inputs1, single, { image: [assetEntry(1), assetEntry(2)], video: [], audio: [] }, urlOf)
    expect(inputs1).toEqual({ image: '/asset/1' })

    const merge = node([['image_a', null], ['image_b', null]])
    const inputs2: Record<string, unknown> = {}
    const warnings = materializeMedia(
      inputs2, merge,
      { image: [assetEntry(1), assetEntry(2), assetEntry(3)], video: [], audio: [] },
      urlOf,
    )
    expect(inputs2).toEqual({ image_a: '/asset/1', image_b: '/asset/2' })
    expect(warnings[0]).toMatch(/extra strip/)
  })

  it('writes Model3D face sockets from the strip in declaration order', () => {
    const n = node([
      ['images.正', 11],
      ['images.左', null],
      ['images.背', null],
      ['images.右', null],
      ['images.辅', null],
    ])
    const table = {
      image: [
        { key: 'l11', src: 'link' as const, link: 11 },
        assetEntry(7),
        assetEntry(8),
      ],
      video: [],
      audio: [],
    }
    const inputs: Record<string, unknown> = { 'images.正': ['3', 0], main_prompt: 'x' }
    const warnings = materializeMedia(inputs, n, table, urlOf)
    expect(warnings).toEqual([])
    expect(inputs).toEqual({
      'images.正': ['3', 0],
      'images.左': '/asset/7',
      'images.背': '/asset/8',
      main_prompt: 'x',
    })
  })

  it('skips unresolved entries with a warning and compacts', () => {
    const n = node([['images.image0', null]])
    const table = { image: [{ key: 'l99', src: 'link' as const, link: 99 }, assetEntry(1)], video: [], audio: [] }
    const inputs: Record<string, unknown> = {}
    const warnings = materializeMedia(inputs, n, table, urlOf)
    expect(inputs).toEqual({ 'images.image0': '/asset/1' })
    expect(warnings[0]).toMatch(/image 1/)
  })

  it('caps at the autogrow max', () => {
    const n = { ...node([['images.image0', null]]), comfyDynamic: { autogrow: { images: { max: 2 } } } }
    const table = { image: [assetEntry(1), assetEntry(2), assetEntry(3)], video: [], audio: [] }
    const inputs: Record<string, unknown> = {}
    const warnings = materializeMedia(inputs, n, table, urlOf)
    expect(Object.keys(inputs)).toEqual(['images.image0', 'images.image1'])
    expect(warnings[0]).toMatch(/at most 2/)
  })
})
