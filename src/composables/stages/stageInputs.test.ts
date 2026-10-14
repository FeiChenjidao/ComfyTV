import { describe, expect, it } from 'vitest'

import type { ResolvedInput } from '@/stores/stageStore'

import { coerceImageUrl, pickSourceImageUrl, resolveCompareSlot } from './stageInputs'

function input(p: Partial<ResolvedInput>): ResolvedInput {
  return { slot: 'image', type: 'COMFYTV_IMAGE', source: 'upstream', content: '/img.png', ...p }
}

describe('pickSourceImageUrl', () => {
  it('returns the content of a resolved upstream image input', () => {
    expect(pickSourceImageUrl([input({ content: '/a.png' })])).toBe('/a.png')
  })

  it('returns null when the image slot is absent', () => {
    expect(pickSourceImageUrl([input({ slot: 'mask' })])).toBeNull()
  })

  it('returns null when the source is not upstream', () => {
    expect(pickSourceImageUrl([input({ source: 'empty' })])).toBeNull()
    expect(pickSourceImageUrl([input({ source: 'upstream-pending', content: null })])).toBeNull()
  })

  it('returns null when content is empty or null', () => {
    expect(pickSourceImageUrl([input({ content: null })])).toBeNull()
    expect(pickSourceImageUrl([input({ content: '' })])).toBeNull()
  })

  it('honors a custom slot name', () => {
    const inputs = [input({ slot: 'image', content: '/main.png' }), input({ slot: 'ref', content: '/ref.png' })]
    expect(pickSourceImageUrl(inputs, 'ref')).toBe('/ref.png')
  })

  it('returns null for an empty input list', () => {
    expect(pickSourceImageUrl([])).toBeNull()
  })
})

describe('coerceImageUrl', () => {
  it('passes through a plain image URL', () => {
    expect(coerceImageUrl('/view?filename=a.png')).toBe('/view?filename=a.png')
  })

  it('unwraps a COMFYTV_IMAGES batch to the first item', () => {
    const batch = JSON.stringify({
      images: [
        { index: '1', image_url: '/a.png' },
        { index: '2', image_url: '/b.png' },
      ],
    })
    expect(coerceImageUrl(batch)).toBe('/a.png')
  })

  it('returns null for empty content', () => {
    expect(coerceImageUrl(null)).toBeNull()
    expect(coerceImageUrl('')).toBeNull()
    expect(coerceImageUrl('   ')).toBeNull()
  })
})

describe('resolveCompareSlot', () => {
  it('marks empty when no link', () => {
    expect(resolveCompareSlot([input({ slot: 'image_a', source: 'empty', content: null })], 'image_a'))
      .toEqual({ wired: false, url: null })
  })

  it('marks wired without url when upstream is pending', () => {
    expect(resolveCompareSlot(
      [input({ slot: 'image_a', source: 'upstream-pending', content: null })],
      'image_a',
    )).toEqual({ wired: true, url: null })
  })

  it('returns wired + url for a single image', () => {
    expect(resolveCompareSlot(
      [input({ slot: 'image_a', content: '/a.png' })],
      'image_a',
    )).toEqual({ wired: true, url: '/a.png' })
  })

  it('unwraps a batch on a wired slot', () => {
    const batch = JSON.stringify({ images: [{ index: '1', image_url: '/batch.png' }] })
    expect(resolveCompareSlot(
      [input({ slot: 'image_b', type: 'COMFYTV_IMAGES', content: batch })],
      'image_b',
    )).toEqual({ wired: true, url: '/batch.png' })
  })
})
