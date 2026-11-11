import { describe, expect, it, vi } from 'vitest'

import { app } from '@/lib/comfyApp'
import { resolveMediaSrc } from './mediaSrc'

function withApiApiURL(impl: (url: string) => string) {
  ;(app as any).api.apiURL = impl
}

describe('resolveMediaSrc', () => {
  it('prefixes a root-relative view URL with the API base', () => {
    withApiApiURL((u) => `http://comfy.test/api${u}`)
    expect(resolveMediaSrc('/view?filename=a.png&type=output'))
      .toBe('http://comfy.test/api/view?filename=a.png&type=output')
  })

  it('does not double the /api prefix', () => {
    withApiApiURL((u) => `http://comfy.test/api${u}`)
    expect(resolveMediaSrc('/api/view?filename=a.png'))
      .toBe('http://comfy.test/api/view?filename=a.png')
  })

  it('passes absolute, blob and data URLs through', () => {
    withApiApiURL(vi.fn((u: string) => `http://comfy.test/api${u}`))
    expect(resolveMediaSrc('https://cdn.test/a.png')).toBe('https://cdn.test/a.png')
    expect(resolveMediaSrc('blob:http://x/abc')).toBe('blob:http://x/abc')
    expect(resolveMediaSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect((app as any).api.apiURL).not.toHaveBeenCalled()
  })

  it('rejects empty input and batch JSON', () => {
    withApiApiURL((u) => `http://comfy.test/api${u}`)
    expect(resolveMediaSrc('')).toBeNull()
    expect(resolveMediaSrc(null)).toBeNull()
    expect(resolveMediaSrc('   ')).toBeNull()
    expect(resolveMediaSrc(JSON.stringify({ images: [{ image_url: '/a.png' }] }))).toBeNull()
  })
})
