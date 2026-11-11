import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StageState } from '@/stores/stageStore'
import {
  downloadOutputImages,
  filenameFromUrl,
  outputImageItems,
  outputImageUrl,
  resolveDownloadHref,
} from '@/v2/imageToolbar'
import { app } from '@/lib/comfyApp'
import * as download from '@/utils/download'

function state(output: string | null, pickedIndex?: number): StageState {
  return {
    kind: 'image-batch',
    variant: 'transform',
    outputType: 'COMFYTV_IMAGE',
    output,
    outputs: [],
    running: false,
    inputs: [],
    mainPrompt: '',
    pickedIndex,
  }
}

const crops = JSON.stringify({
  images: [
    { image_url: '/api/view?filename=comfytv-crop-7-a-1.png&type=output', label: '1' },
    { image_url: '/api/view?filename=comfytv-crop-7-a-2.png&type=output', label: '2' },
    { image_url: '/view?filename=comfytv%20crop%203.png&type=output', label: '3' },
  ],
})

describe('outputImageItems', () => {
  it('reads every image in a crop batch, not only the picked one', () => {
    const items = outputImageItems(state(crops, 2))
    expect(items.map((item) => item.url)).toEqual([
      '/api/view?filename=comfytv-crop-7-a-1.png&type=output',
      '/api/view?filename=comfytv-crop-7-a-2.png&type=output',
      '/view?filename=comfytv%20crop%203.png&type=output',
    ])
  })

  it('keeps a plain url as one item', () => {
    expect(outputImageItems(state('/view?filename=one.png'))).toEqual([
      { url: '/view?filename=one.png', label: '' },
    ])
  })

  it('drops images without a url', () => {
    expect(outputImageItems(state(JSON.stringify({ images: [{ label: 'x' }, { url: '/a.png' }] }))))
      .toEqual([{ url: '/a.png', label: '' }])
  })
})

describe('outputImageUrl', () => {
  it('still points the preview at the selected crop', () => {
    expect(outputImageUrl(state(crops, 2))).toContain('crop-7-a-2')
  })

  it('ignores pickedIndex when there is only one image', () => {
    expect(outputImageUrl(state('/only.png', 4))).toBe('/only.png')
  })
})

describe('filenameFromUrl', () => {
  it('prefers the filename query and decodes it', () => {
    expect(filenameFromUrl('/view?filename=comfytv%20crop%203.png&type=output')).toBe('comfytv crop 3.png')
  })

  it('falls back to the path tail', () => {
    expect(filenameFromUrl('/files/out.png')).toBe('out.png')
  })
})

describe('downloadOutputImages', () => {
  const clicks: Array<{ href: string; download: string }> = []

  beforeEach(() => {
    clicks.length = 0
    vi.restoreAllMocks()
    ;(app as any).api.apiURL = (url: string) => `http://comfy.test${url}`
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download })
    })
  })

  it('downloads a single image as a file', async () => {
    await downloadOutputImages(state('/view?filename=one.png'))
    expect(clicks).toEqual([
      { href: 'http://comfy.test/view?filename=one.png', download: 'one.png' },
    ])
    expect(resolveDownloadHref('/api/view?filename=one.png')).toBe('http://comfy.test/view?filename=one.png')
  })

  it('zips every crop instead of saving only the last selection', async () => {
    const bodies: Record<string, Uint8Array> = {
      'comfytv-crop-7-a-1.png': new Uint8Array([1, 2, 3]),
      'comfytv-crop-7-a-2.png': new Uint8Array([4, 5]),
      'comfytv crop 3.png': new Uint8Array([6]),
    }
    const saved: Array<{ name: string; bytes: Uint8Array }> = []
    vi.spyOn(download, 'downloadBlob').mockImplementation((name, blob) => {
      void blob.arrayBuffer().then((buf) => saved.push({ name, bytes: new Uint8Array(buf) }))
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const href = String(input)
      const name = decodeURIComponent(new URL(href).searchParams.get('filename') ?? '')
      const bytes = bodies[name]
      if (!bytes) return new Response('missing', { status: 404 })
      return new Response(new Blob([bytes as BlobPart]), { status: 200 })
    })

    await downloadOutputImages(state(crops, 3))
    await vi.waitFor(() => expect(saved).toHaveLength(1))

    expect(clicks).toEqual([])
    expect(saved[0]!.name).toBe('crops.zip')
    const packed = unzipSync(saved[0]!.bytes)
    expect(Object.keys(packed).sort()).toEqual([
      'comfytv crop 3.png',
      'comfytv-crop-7-a-1.png',
      'comfytv-crop-7-a-2.png',
    ])
    expect(Array.from(packed['comfytv-crop-7-a-2.png']!)).toEqual([4, 5])
  })

  it('renames a colliding zip entry instead of dropping it', async () => {
    const batch = JSON.stringify({
      images: [
        { url: '/view?filename=same.png' },
        { url: '/view?filename=same.png&subfolder=b' },
      ],
    })
    const saved: Array<{ name: string; bytes: Uint8Array }> = []
    vi.spyOn(download, 'downloadBlob').mockImplementation((name, blob) => {
      void blob.arrayBuffer().then((buf) => saved.push({ name, bytes: new Uint8Array(buf) }))
    })
    let n = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n += 1
      return new Response(new Blob([new Uint8Array([n]) as BlobPart]), { status: 200 })
    })
    await downloadOutputImages(state(batch))
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    const packed = unzipSync(saved[0]!.bytes)
    expect(Object.keys(packed).sort()).toEqual(['same-2.png', 'same.png'])
  })

  it('does nothing when there is no output', async () => {
    await downloadOutputImages(state('   '))
    expect(clicks).toEqual([])
  })
})
