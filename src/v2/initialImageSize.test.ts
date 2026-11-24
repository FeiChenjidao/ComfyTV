import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

import { app } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { bindInitialImageSize, initialImagePreviewSize, initialImageUrl } from './initialImageSize'

const mocks = vi.hoisted(() => ({
  loadMediaInfo: vi.fn(),
  observe: [] as Array<() => void>,
  stop: vi.fn(),
}))
vi.mock('@/composables/stages/useMediaInfo', () => ({ loadMediaInfo: mocks.loadMediaInfo }))
vi.mock('@vueuse/core', () => ({
  useResizeObserver: (_el: unknown, callback: () => void) => {
    mocks.observe.push(callback)
    return { stop: mocks.stop }
  },
  useMutationObserver: (_el: unknown, callback: () => void) => {
    mocks.observe.push(callback)
    return { stop: mocks.stop }
  },
}))

const scopes: ReturnType<typeof effectScope>[] = []
function setup(overrides: Partial<StageState> = {}, properties = {}, fromSave = false) {
  const state = reactive({ kind: 'image', variant: 'loader', output: null, pool: null, inputs: [], ...overrides }) as StageState
  const node: any = {
    size: [340, 500], properties, __comfytvFromSave: fromSave,
    setSize: vi.fn(), onResize: vi.fn(),
  }
  const card = document.createElement('div')
  const box = document.createElement('div')
  let laidOut = true
  Object.defineProperty(card, 'offsetHeight', { get: () => laidOut ? 500 : 0 })
  Object.defineProperty(box, 'offsetHeight', { get: () => laidOut ? 300 : 0 })
  Object.defineProperty(box, 'clientWidth', { get: () => laidOut ? 320 : 0 })
  const scope = effectScope(true)
  scopes.push(scope)
  const resize = vi.fn(() => true)
  bindInitialImageSize(node, { scope, state, card, box: () => box, resize })
  return { node, state, scope, resize, layout: (value: boolean) => { laidOut = value } }
}
async function flush() { await nextTick(); await Promise.resolve(); await nextTick() }
const info = (width = 1600, height = 900) => ({ kind: 'image', width, height })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.observe.length = 0
  mocks.loadMediaInfo.mockReset().mockResolvedValue(info())
  ;(app as any).canvas.resizing_node = null
})
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })

describe('initial image size', () => {
  it('uses image proportions with a fixed base size, independent of pixel resolution', () => {
    expect(initialImagePreviewSize(1600, 900)).toEqual([480, 270])
    expect(initialImagePreviewSize(16000, 9000)).toEqual([480, 270])
    expect(initialImagePreviewSize(900, 1600)).toEqual([320, 569])
    expect(initialImagePreviewSize(1000, 1000)).toEqual([360, 360])
    expect(initialImagePreviewSize(10000, 100)).toEqual([720, 170])
    expect(initialImagePreviewSize(100, 10000)).toEqual([320, 720])
  })

  it('fits imported images when the first output arrives and includes the node border', async () => {
    const { state, resize, node } = setup()
    expect(mocks.loadMediaInfo).not.toHaveBeenCalled()
    state.output = '/view?filename=import.png'
    await flush()
    expect(resize).toHaveBeenCalledExactlyOnceWith(500, 270)
    expect(node.properties.v2_initial_image_fit).toBe(true)
    expect(mocks.stop).toHaveBeenCalledTimes(2)
  })

  it('waits for an upstream connection and prefers its first image over other media', async () => {
    const { state, resize } = setup({ variant: 'generator' })
    state.inputs = [
      { slot: 'text', type: 'COMFYTV_TEXT', source: 'upstream', content: 'prompt' },
      { slot: 'images.image0', type: 'COMFYTV_IMAGES', source: 'upstream', content: '{"images":[{"image_url":"/view?filename=upstream.png"}]}' },
    ]
    await flush()
    expect(mocks.loadMediaInfo).toHaveBeenCalledWith('/view?filename=upstream.png')
    expect(resize).toHaveBeenCalledOnce()
  })

  it('never resizes a second time when content or the selected batch item changes', async () => {
    const { state, resize } = setup({ output: '/view?filename=first.png' })
    await flush()
    resize.mockClear()
    mocks.loadMediaInfo.mockClear()
    state.output = '/view?filename=portrait.png'
    state.pickedIndex = 2
    await flush()
    expect(resize).not.toHaveBeenCalled()
    expect(mocks.loadMediaInfo).not.toHaveBeenCalled()
  })

  it('waits for pending upstream content instead of fitting an old placeholder output', async () => {
    const { state, resize } = setup({
      output: 'placeholder.png',
      inputs: [{ slot: 'image', type: 'COMFYTV_IMAGE', source: 'upstream-pending', content: null }],
    })
    await flush()
    expect(mocks.loadMediaInfo).not.toHaveBeenCalled()
    state.inputs[0].source = 'upstream'
    state.inputs[0].content = 'source.png'
    await flush()
    expect(mocks.loadMediaInfo).toHaveBeenCalledExactlyOnceWith('source.png')
    expect(resize).toHaveBeenCalledOnce()
  })

  it('preserves fitted sizes across remounts and skips nodes restored from a workflow', async () => {
    const fitted = setup({ output: 'image.png' }, { v2_initial_image_fit: true })
    const restored = setup({ output: 'image.png' }, {}, true)
    await flush()
    expect(fitted.resize).not.toHaveBeenCalled()
    expect(restored.resize).not.toHaveBeenCalled()
    expect(mocks.loadMediaInfo).not.toHaveBeenCalled()
  })

  it('checks restored status again if a load finishes after graph restoration', async () => {
    let resolve!: (value: unknown) => void
    mocks.loadMediaInfo.mockReturnValue(new Promise(r => { resolve = r }))
    const { node, resize } = setup({ output: 'image.png' })
    node.__comfytvFromSave = true
    resolve(info())
    await flush()
    expect(resize).not.toHaveBeenCalled()
  })

  it('ignores stale image measurements if the first connection is replaced before loading', async () => {
    const resolve: Array<(value: unknown) => void> = []
    mocks.loadMediaInfo.mockImplementation(() => new Promise(r => { resolve.push(r) }))
    const { state, resize } = setup({ output: 'first.png' })
    state.output = 'second.png'
    await nextTick()
    resolve[0](info())
    await flush()
    expect(resize).not.toHaveBeenCalled()
    resolve[1](info(900, 1600))
    await flush()
    expect(resize).toHaveBeenCalledExactlyOnceWith(340, 569)
  })

  it('waits for actual layout before consuming the one-time adjustment', async () => {
    const { layout, resize, node } = setup({ output: 'image.png' })
    layout(false)
    await flush()
    expect(resize).not.toHaveBeenCalled()
    expect(node.properties.v2_initial_image_fit).toBeUndefined()
    layout(true)
    mocks.observe[0]()
    expect(resize).toHaveBeenCalledOnce()
  })

  it('lets a manual resize before loading take precedence', async () => {
    let resolve!: (value: unknown) => void
    mocks.loadMediaInfo.mockReturnValue(new Promise(r => { resolve = r }))
    const { node, resize } = setup({ output: 'image.png' })
    ;(app as any).canvas.resizing_node = node
    node.onResize([600, 500])
    ;(app as any).canvas.resizing_node = null
    resolve(info())
    await flush()
    expect(resize).not.toHaveBeenCalled()
    expect(node.properties.v2_initial_image_fit).toBe(true)
  })

  it('ignores invalid metadata without consuming the adjustment', async () => {
    mocks.loadMediaInfo.mockResolvedValueOnce({ kind: 'image', width: 0, height: 100 })
    const { state, resize, node } = setup({ output: 'invalid.png' })
    await flush()
    expect(node.properties.v2_initial_image_fit).toBeUndefined()
    state.output = 'valid.png'
    await flush()
    expect(resize).toHaveBeenCalledOnce()
  })

  it('keeps a width resized by the DOM node renderer while metadata was loading', async () => {
    let resolve!: (value: unknown) => void
    mocks.loadMediaInfo.mockReturnValue(new Promise(r => { resolve = r }))
    const { node, resize } = setup({ output: 'image.png' })
    node.size = [600, 700]
    resolve(info())
    await flush()
    expect(resize).not.toHaveBeenCalled()
    expect(node.size).toEqual([600, 700])
  })

  it('does not touch non-image stages or resize removed nodes', async () => {
    const nonImage = setup({ kind: 'model', output: 'model.glb' })
    expect(mocks.loadMediaInfo).not.toHaveBeenCalled()
    const removed = setup({ output: 'image.png' })
    removed.scope.stop()
    await flush()
    expect(nonImage.resize).not.toHaveBeenCalled()
    expect(removed.resize).not.toHaveBeenCalled()
  })

  it('can use the output or picker pool when no upstream image exists', () => {
    const { state } = setup({ kind: 'image-picker', pool: '{"images":[{"image_url":"pool.png"}]}' })
    expect(initialImageUrl(state)).toBe('pool.png')
    state.output = 'output.png'
    expect(initialImageUrl(state)).toBe('output.png')
  })
})
