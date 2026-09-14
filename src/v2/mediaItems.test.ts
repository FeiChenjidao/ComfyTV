import { describe, expect, it } from 'vitest'

import { lodPosterUrl, mediaItems, pickedMediaIndex, pickedMediaItem, previewUrlFromPayload } from './mediaItems'

const batch = JSON.stringify({
  images: [
    { image_url: '/view?filename=a.png', label: 'A' },
    { image_url: '/view?filename=b.png' },
    { image_url: '' },
  ],
})

describe('mediaItems', () => {
  it('parses batch JSON and drops empty urls', () => {
    expect(mediaItems({ output: batch, pool: null }, 'batch')).toEqual([
      { url: '/view?filename=a.png', label: 'A' },
      { url: '/view?filename=b.png', label: '' },
    ])
  })

  it('treats a plain output url as a single batch item', () => {
    expect(mediaItems({ output: '/view?filename=x.mp4', pool: null }, 'batch'))
      .toEqual([{ url: '/view?filename=x.mp4', label: '' }])
  })

  it('pool source reads state.pool and never falls back to raw strings', () => {
    expect(mediaItems({ output: '/view?x', pool: batch }, 'pool')).toHaveLength(2)
    expect(mediaItems({ output: null, pool: '/view?x' }, 'pool')).toEqual([])
    expect(mediaItems({ output: null, pool: '' }, 'pool')).toEqual([])
  })
})

describe('pickedMediaIndex / pickedMediaItem', () => {
  it('clamps to [1, count] and defaults to 1', () => {
    expect(pickedMediaIndex({ pickedIndex: undefined }, 3)).toBe(1)
    expect(pickedMediaIndex({ pickedIndex: 9 }, 3)).toBe(3)
    expect(pickedMediaIndex({ pickedIndex: 0 }, 0)).toBe(1)
  })

  it('returns the picked item or null', () => {
    expect(pickedMediaItem({ output: batch, pool: null, pickedIndex: 2 }, 'batch')?.url)
      .toBe('/view?filename=b.png')
    expect(pickedMediaItem({ output: null, pool: null, pickedIndex: 2 }, 'batch')).toBeNull()
  })
})

describe('previewUrlFromPayload', () => {
  it('reads a plain url or the first batch cell', () => {
    expect(previewUrlFromPayload(null)).toBeNull()
    expect(previewUrlFromPayload('/view?filename=x.png')).toBe('/view?filename=x.png')
    expect(previewUrlFromPayload(batch)).toBe('/view?filename=a.png')
    expect(previewUrlFromPayload('{"images":[]}')).toBeNull()
  })
})

describe('lodPosterUrl', () => {
  const group = JSON.stringify({
    images: [
      { image_url: '/view?filename=g0.png' },
      { image_url: '/view?filename=g1.png' },
    ],
  })
  const state = (partial: Record<string, unknown>) => ({
    output: null,
    pool: null,
    pickedIndex: 1,
    inputs: [],
    ...partial,
  } as Parameters<typeof lodPosterUrl>[0])

  it('prefers a connected still image over split output crops', () => {
    expect(lodPosterUrl(state({
      output: batch,
      inputs: [{ slot: 'image', content: '/view?filename=src.png' }],
    }), 'batch', { preferImageInput: true })).toBe('/view?filename=src.png')
  })

  it('uses output first, then image input, then the images group', () => {
    expect(lodPosterUrl(state({
      output: batch,
      inputs: [{ slot: 'image', content: '/view?filename=src.png' }],
    }), 'batch')).toBe('/view?filename=a.png')
    expect(lodPosterUrl(state({
      inputs: [{ slot: 'image', content: '/view?filename=src.png' }],
    }), 'batch')).toBe('/view?filename=src.png')
    expect(lodPosterUrl(state({
      inputs: [
        { slot: 'image', content: '{"images":[]}' },
        { slot: 'images', content: group },
      ],
    }), 'batch')).toBe('/view?filename=g0.png')
  })

  it('returns empty when nothing is connected', () => {
    expect(lodPosterUrl(state({}), 'batch')).toBe('')
  })
})
