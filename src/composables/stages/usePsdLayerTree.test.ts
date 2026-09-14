import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import type { ResolvedInput, StageState } from '@/stores/stageStore'
import { useStageStore } from '@/stores/stageStore'

const mocks = vi.hoisted(() => ({
  uploadCanvas: vi.fn(async (_c: unknown, opts: { filename: string; subfolder: string }) =>
    `/view?filename=${opts.filename}&subfolder=${opts.subfolder}&type=input`),
  uploadBlobNamed: vi.fn(async (_blob: Blob, opts: { filename: string; subfolder: string }) => ({
    name: opts.filename,
    subfolder: opts.subfolder,
    type: 'input' as const,
    url: `/view?filename=${opts.filename}&subfolder=${opts.subfolder}&type=input`,
  })),
}))

vi.mock('@/utils/uploadCanvas', () => ({
  uploadCanvas: mocks.uploadCanvas,
  uploadBlobNamed: mocks.uploadBlobNamed,
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

import { viewUrlFromUpload, usePsdLayerTree } from './usePsdLayerTree'
import { uploadCanvas } from '@/utils/uploadCanvas'

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  save: vi.fn(),
  restore: vi.fn(),
  drawImage: vi.fn(),
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
})) as any

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
    ],
    onConfigure: null as any,
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
    mocks.uploadBlobNamed.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uploads a transparent composite at document size after picking a PSD', async () => {
    const store = useStageStore()
    const spy = vi.spyOn(store, 'applyExecutedPayload')
    const node = makeNode()
    const { pickFiles, rows, width, height, selectedId, displayedRows } = usePsdLayerTree(node, makeState())
    const file = new File([new Uint8Array([1, 2, 3])], 'hero.psd')
    await pickFiles([file])

    expect(mocks.uploadBlobNamed).toHaveBeenCalledWith(file, {
      subfolder: 'comfytv/psd',
      filename: 'hero.psd',
    })
    expect(width.value).toBe(32)
    expect(height.value).toBe(24)
    expect(rows.value[0].kind).toBe('document')
    expect(selectedId.value).toBe('__root__')
    expect(displayedRows.value.map(r => r.id)).toEqual(['__root__'])

    await vi.advanceTimersByTimeAsync(300)
    expect(uploadCanvas).toHaveBeenCalledTimes(3)
    const [, opts] = (uploadCanvas as any).mock.calls[0]
    expect(opts.subfolder).toBe('comfytv/psdlayer')
    expect(spy).toHaveBeenCalledTimes(1)
    const payload = spy.mock.calls[0]![1] as { output: string[]; picked: string[] }
    expect(payload.output[0]).toContain('filename=comfytv-psdlayer')
    expect(JSON.parse(payload.picked[0]).images).toHaveLength(2)
    expect(node.widgets.find((w: { name: string }) => w.name === 'captured_images').value)
      .toContain('"images"')
  })

  it('does not upload when the selection is cleared before debounce', async () => {
    const node = makeNode()
    const { pickFiles, selectId } = usePsdLayerTree(node, makeState())
    await pickFiles([new File([new Uint8Array([1])], 'a.psd')])
    selectId('')
    await vi.advanceTimersByTimeAsync(300)
    expect(uploadCanvas).not.toHaveBeenCalled()
  })

  it('does not upload an unknown selected id', async () => {
    const node = makeNode()
    const { pickFiles, selectId } = usePsdLayerTree(node, makeState())
    await pickFiles([new File([new Uint8Array([1])], 'a.psd')])
    selectId('missing')
    await vi.advanceTimersByTimeAsync(300)
    expect(uploadCanvas).not.toHaveBeenCalled()
  })

  it('toggle-select persists a JSON id list and still uploads one composite', async () => {
    const node = makeNode()
    const { pickFiles, selectId, selectedIds } = usePsdLayerTree(node, makeState())
    await pickFiles([new File([new Uint8Array([1])], 'a.psd')])
    mocks.uploadCanvas.mockClear()
    selectId('L0')
    selectId('L1', { toggle: true })
    expect(selectedIds.value).toEqual(['L0', 'L1'])
    const widget = node.widgets.find((w: { name: string }) => w.name === 'selected_id')
    expect(widget.value).toBe(JSON.stringify(['L0', 'L1']))
    await vi.advanceTimersByTimeAsync(300)
    expect(uploadCanvas).toHaveBeenCalledTimes(3)
    const batch = node.widgets.find((w: { name: string }) => w.name === 'captured_images').value
    expect(JSON.parse(batch).images.map((im: { label: string }) => im.label)).toEqual(['Layer A', 'Layer B'])
  })

  it('restores a JSON selected_id list on configure', async () => {
    const node = makeNode({ selected_id: JSON.stringify(['L1', 'L0']) })
    const { selectedIds } = usePsdLayerTree(node, makeState())
    expect(selectedIds.value).toEqual(['L1', 'L0'])
    node.onConfigure({})
    expect(selectedIds.value).toEqual(['L1', 'L0'])
  })
})
