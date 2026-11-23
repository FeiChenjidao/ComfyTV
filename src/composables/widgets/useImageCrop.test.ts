import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useImageCrop, type Bounds } from './useImageCrop'

function setup(initial: Bounds) {
  const imageEl = ref<HTMLImageElement | null>(null)
  const containerEl = ref<HTMLDivElement | null>(document.createElement('div'))
  const sourceImageUrl = ref<string | null>('/first.png')
  const modelValue = ref<Bounds>({ ...initial })
  const crop = useImageCrop({ imageEl, containerEl, sourceImageUrl, modelValue })
  return { crop, imageEl, sourceImageUrl, modelValue }
}

function image(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement
}

describe('useImageCrop', () => {
  it('keeps the selected bounds when the upstream image URL refreshes', () => {
    const { crop, imageEl, sourceImageUrl, modelValue } = setup({
      x: 41, y: 23, width: 180, height: 120,
    })
    imageEl.value = image(640, 480)
    crop.handleImageLoad()
    expect(modelValue.value).toEqual({ x: 41, y: 23, width: 180, height: 120 })

    sourceImageUrl.value = '/refreshed.png'
    imageEl.value = image(640, 480)
    crop.handleImageLoad()

    expect(modelValue.value).toEqual({ x: 41, y: 23, width: 180, height: 120 })
  })

  it('creates a default box when bounds have not been initialized', () => {
    const { crop, imageEl, modelValue } = setup({ x: 0, y: 0, width: 0, height: 0 })
    imageEl.value = image(640, 480)
    crop.handleImageLoad()

    expect(modelValue.value).toEqual({ x: 96, y: 72, width: 448, height: 336 })
  })
})
