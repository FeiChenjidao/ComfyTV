import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { ResolvedInput, StageState } from '@/stores/stageStore'
import { useStageStore } from '@/stores/stageStore'

const mocks = vi.hoisted(() => ({
  uploadCanvas: vi.fn(async (_c: unknown, opts: { filename: string; subfolder: string }) =>
    `/view?filename=${opts.filename}&subfolder=${opts.subfolder}&type=input`),
  fetchApi: vi.fn(),
}))

vi.mock('@/utils/uploadCanvas', () => ({
  uploadCanvas: mocks.uploadCanvas,
}))

vi.mock('@/lib/comfyApp', () => ({
  app: { api: { fetchApi: mocks.fetchApi } },
}))

vi.mock('ag-psd', () => ({
  readPsd: vi.fn(() => ({
    width: 32,
    height: 24,
    children: [
      { name: 'Layer A', left: 0, top: 0, right: 8, bottom: 8 },
      { name: 'Layer B', left: 8, top: 0, right: 16, bottom: 8 },
    ],
  })),
  getLayerCanvas: vi.fn(() => {
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    return c
  }),
  getLayerMaskCanvas: vi.fn(() => undefined),
}))

import {
  basenameOfPath,
  isLocalPsdPath,
  localPsdFetchUrl,
  PSD_ROOT_ID,
  usePsdLayerTree,
  viewUrlFromUpload,
} from './usePsdLayerTree'
import { uploadCanvas } from '@/utils/uploadCanvas'

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  save: vi.fn(),
  restore: vi.fn(),
  drawImage: vi.fn(),
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
})) as any

HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
  cb(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }))
}

vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:mock-preview'),
  revokeObjectURL: vi.fn(),
})

function makeWidget(name: string, value = '') {
  return { name, value, callback: vi.fn() }
}

function makeNode(values: Record<string, string> = {}): any {
  return {
    id: 11,
    widgets: [
      makeWidget('psd_file', values.psd_file ?? ''),
      makeWidget('selected_id', values.selected_id ?? ''),
      makeWidget('captured_image', values.captured_image ?? ''),
      makeWidget('captured_images', values.captured_images ?? ''),
      makeWidget('out_width', values.out_width ?? ''),
      makeWidget('out_height', values.out_height ?? ''),
    ],
    onConfigure: null as any,
    setDirtyCanvas: vi.fn(),
  }
}

function makeState(): StageState {
  const inputs: ResolvedInput[] = []
  return reactive({
    kind: 'image', variant: 'loader',
    outputType: 'COMFYTV_IMAGE',
    output: null, outputs: [null],
    running: false, inputs, mainPrompt: '',
  }) as StageState
}

function mockPsdBytes() {
  return new ArrayBuffer(8)
}

describe('path helpers', () => {
  it('detects local paths vs legacy view URLs', () => {
    expect(isLocalPsdPath('D:\\art\\hero.psd')).toBe(true)
    expect(isLocalPsdPath('/view?filename=hero.psd&subfolder=comfytv/psd')).toBe(false)
    expect(basenameOfPath('D:\\art\\hero.psd')).toBe('hero.psd')
    expect(localPsdFetchUrl('D:\\art\\hero.psd')).toContain('path=D')
  })
})

describe('viewUrlFromUpload', () => {
  it('builds a /view URL for the uploaded PSD', () => {
    expect(viewUrlFromUpload('doc.psd', 'comfytv/psd'))
      .toBe('/view?filename=doc.psd&subfolder=comfytv%2Fpsd&type=input')
  })
})

describe('usePsdLayerTree', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mocks.uploadCanvas.mockClear()
    mocks.fetchApi.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pickLocalPsd stores absolute path and does not upload a copy', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    mocks.fetchApi
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, path: 'D:\\art\\hero.psd', name: 'hero.psd' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => mockPsdBytes(),
      })

    const node = makeNode()
    const { pickLocalPsd, width, height, selectedId, dirty } = usePsdLayerTree(node, makeState())
    await pickLocalPsd()

    expect(mocks.fetchApi).toHaveBeenNthCalledWith(1, '/comfytv/psd/pick', { method: 'POST' })
    expect(node.widgets.find((w: { name: string }) => w.name === 'psd_file').value)
      .toBe('D:\\art\\hero.psd')
    expect(width.value).toBe(32)
    expect(height.value).toBe(24)
    expect(selectedId.value).toBe('__root__')
    expect(dirty.value).toBe(true)

    await vi.advanceTimersByTimeAsync(200)
    expect(uploadCanvas).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows pathMissing when the stored local file is gone', async () => {
    mocks.fetchApi.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'missing' }),
    })
    const node = makeNode({ psd_file: 'D:\\gone\\missing.psd' })
    const { error, fileName } = usePsdLayerTree(node, makeState())
    // constructor kicks loadFromWidgetUrl
    await vi.waitFor(() => expect(error.value).toBeTruthy())
    expect(error.value).toMatch(/路径 PSD 丢失|PSD path missing|pathMissing/)
    expect(fileName.value).toBe('missing')
  })

  it('exportSelection uploads one full-pixel composite', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    mocks.fetchApi
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, path: 'D:\\a.psd', name: 'a.psd' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => mockPsdBytes(),
      })
    const node = makeNode()
    const { pickLocalPsd, exportSelection, dirty } = usePsdLayerTree(node, makeState())
    await pickLocalPsd()
    await vi.advanceTimersByTimeAsync(200)
    mocks.uploadCanvas.mockClear()

    await exportSelection()
    expect(uploadCanvas).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(dirty.value).toBe(false)
  })

  it('does not upload when the selection is cleared before preview debounce', async () => {
    mocks.fetchApi
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ok: true, path: 'D:\\a.psd', name: 'a.psd' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, arrayBuffer: async () => mockPsdBytes(),
      })
    const node = makeNode()
    const { pickLocalPsd, selectId } = usePsdLayerTree(node, makeState())
    await pickLocalPsd()
    selectId('')
    await vi.advanceTimersByTimeAsync(300)
    expect(uploadCanvas).not.toHaveBeenCalled()
  })

  it('toggle-select persists a JSON id list without uploading', async () => {
    mocks.fetchApi
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ok: true, path: 'D:\\a.psd', name: 'a.psd' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, arrayBuffer: async () => mockPsdBytes(),
      })
    const node = makeNode()
    const { pickLocalPsd, selectId, selectedIds, dirty } = usePsdLayerTree(node, makeState())
    await pickLocalPsd()
    mocks.uploadCanvas.mockClear()
    selectId('L0')
    selectId('L1', { toggle: true })
    expect(selectedIds.value).toEqual(['L0', 'L1'])
    expect(node.widgets.find((w: { name: string }) => w.name === 'selected_id').value)
      .toBe(JSON.stringify(['L0', 'L1']))
    await vi.advanceTimersByTimeAsync(300)
    expect(uploadCanvas).not.toHaveBeenCalled()
    expect(dirty.value).toBe(true)
  })

  it('export with slices uploads one image per selected root', async () => {
    mocks.fetchApi
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ok: true, path: 'D:\\a.psd', name: 'a.psd' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, arrayBuffer: async () => mockPsdBytes(),
      })
    const node = makeNode()
    const { pickLocalPsd, selectId, exportSelection } = usePsdLayerTree(node, makeState())
    await pickLocalPsd()
    selectId('L0')
    selectId('L1', { toggle: true })
    await vi.advanceTimersByTimeAsync(200)
    mocks.uploadCanvas.mockClear()

    await exportSelection({ slices: true })
    expect(uploadCanvas).toHaveBeenCalledTimes(3)
  })

  it('restores a JSON selected_id list on configure', async () => {
    const node = makeNode({ selected_id: JSON.stringify(['L1', 'L0']) })
    const { selectedIds } = usePsdLayerTree(node, makeState())
    expect(selectedIds.value).toEqual(['L1', 'L0'])
    node.onConfigure({})
    expect(selectedIds.value).toEqual(['L1', 'L0'])
  })

  it('hydrates full-res outputs from widgets even when a psd_file is present', async () => {
    const batch = JSON.stringify({
      images: [{ index: '1', label: 'A', image_url: '/view?a.png' }],
    })
    const node = makeNode({
      psd_file: 'D:\\art\\hero.psd',
      selected_id: PSD_ROOT_ID,
      captured_image: '/view?full.png',
      captured_images: batch,
      out_width: '64',
      out_height: '48',
    })
    mocks.fetchApi.mockResolvedValue({
      ok: true, status: 200, arrayBuffer: async () => mockPsdBytes(),
    })
    const state = makeState()
    const { dirty, outWidth, outHeight } = usePsdLayerTree(node, state)

    expect(state.output).toBe('/view?full.png')
    expect(state.outputs[0]).toBe('/view?full.png')
    expect(state.outputs[1]).toBe(batch)
    expect(dirty.value).toBe(false)
    expect(outWidth.value).toBe(64)
    expect(outHeight.value).toBe(48)

    await vi.advanceTimersByTimeAsync(50)
    // After async PSD reload, widget-backed outputs must still be present for downstream.
    expect(state.outputs[0]).toBe('/view?full.png')
    expect(state.outputs[1]).toBe(batch)
    expect(dirty.value).toBe(false)
  })

  it('reuses finalCache on a second export of the same selection', async () => {
    mocks.fetchApi
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ok: true, path: 'D:\\a.psd', name: 'a.psd' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, arrayBuffer: async () => mockPsdBytes(),
      })
    const node = makeNode()
    const { pickLocalPsd, exportSelection } = usePsdLayerTree(node, makeState())
    await pickLocalPsd()
    await exportSelection()
    expect(uploadCanvas).toHaveBeenCalledTimes(1)
    mocks.uploadCanvas.mockClear()
    await exportSelection()
    expect(uploadCanvas).not.toHaveBeenCalled()
  })

  it('drag-drop without a local path shows pathUnavailable', async () => {
    const node = makeNode()
    const { pickFiles, error } = usePsdLayerTree(node, makeState())
    await pickFiles([new File([new Uint8Array([1])], 'hero.psd')])
    expect(error.value).toMatch(/无法获取本地路径|Cannot get a local path|pathUnavailable/)
    expect(mocks.fetchApi).not.toHaveBeenCalled()
  })
})

