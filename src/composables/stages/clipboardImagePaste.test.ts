import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createNodeAt, uploadBlobNamed } = vi.hoisted(() => ({
  createNodeAt: vi.fn(),
  uploadBlobNamed: vi.fn(),
}))

vi.mock('@/lib/comfyApp', () => ({ app: {} }))
vi.mock('@/composables/stages/spawnFollowUp', () => ({
  IMAGE_LOADER_CLASS: 'ComfyTV.ImageLoaderStage',
  createNodeAt,
}))
vi.mock('@/utils/uploadCanvas', () => ({ uploadBlobNamed }))
vi.mock('@/composables/stages/useLoaderFileDrop', () => ({
  toastLoaderUploadFailed: vi.fn(),
}))

import { handleClipboardImagePaste, pasteClipboardImages } from './clipboardImagePaste'

function loader(): any {
  return {
    comfyClass: 'ComfyTV.ImageLoaderStage',
    widgets: [{ name: 'image', value: '', callback: vi.fn(), options: { values: [] } }],
  }
}

function pasteEvent(target: EventTarget, files: File[]): ClipboardEvent {
  return {
    target,
    defaultPrevented: false,
    clipboardData: {
      items: files.map(file => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as ClipboardEvent
}

describe('clipboard image paste', () => {
  beforeEach(() => {
    createNodeAt.mockReset()
    uploadBlobNamed.mockReset()
  })

  it('uploads the image and seeds a ComfyTV image loader at the cursor', async () => {
    const node = loader()
    const host = {
      canvas: { graph_mouse: [120, 80], selectNode: vi.fn() },
      graph: { setDirtyCanvas: vi.fn() },
    }
    const file = new File(['image'], 'clipboard.png', { type: 'image/png' })
    uploadBlobNamed.mockResolvedValue({ name: 'clipboard_1.png' })
    createNodeAt.mockReturnValue(node)

    await pasteClipboardImages(host, [file])

    expect(uploadBlobNamed).toHaveBeenCalledWith(file, {
      subfolder: 'comfytv/uploads',
      filename: 'clipboard.png',
    })
    expect(createNodeAt).toHaveBeenCalledWith('ComfyTV.ImageLoaderStage', [120, 80])
    expect(node.widgets[0].value).toBe('comfytv/uploads/clipboard_1.png')
    expect(node.widgets[0].options.values).toContain('comfytv/uploads/clipboard_1.png')
    expect(host.canvas.selectNode).toHaveBeenCalledWith(node)
  })

  it('pastes into the selected ComfyTV image loader', async () => {
    const node = loader()
    const host = {
      canvas: { selected_nodes: { 1: node }, graph_mouse: [120, 80], selectNode: vi.fn() },
      graph: { setDirtyCanvas: vi.fn() },
    }
    const file = new File(['image'], 'replacement.png', { type: 'image/png' })
    uploadBlobNamed.mockResolvedValue({ name: 'replacement_1.png' })

    expect(await pasteClipboardImages(host, [file])).toEqual([node])

    expect(createNodeAt).not.toHaveBeenCalled()
    expect(node.widgets[0].value).toBe('comfytv/uploads/replacement_1.png')
    expect(node.widgets[0].callback).toHaveBeenCalledWith('comfytv/uploads/replacement_1.png')
    expect(host.graph.setDirtyCanvas).toHaveBeenCalledWith(true, true)
  })

  it('creates a loader when the selected node is not a ComfyTV image loader', async () => {
    const node = loader()
    const host = {
      canvas: { selected_nodes: { 1: { comfyClass: 'KSampler' } }, graph_mouse: [120, 80] },
      graph: { setDirtyCanvas: vi.fn() },
    }
    uploadBlobNamed.mockResolvedValue({ name: 'clipboard.png' })
    createNodeAt.mockReturnValue(node)

    await pasteClipboardImages(host, [new File(['image'], 'clipboard.png', { type: 'image/png' })])

    expect(createNodeAt).toHaveBeenCalledWith('ComfyTV.ImageLoaderStage', [120, 80])
  })

  it('claims image paste before the core handler', () => {
    uploadBlobNamed.mockResolvedValue({ name: 'clipboard.png' })
    createNodeAt.mockReturnValue(loader())
    const event = pasteEvent(document.body, [
      new File(['image'], 'clipboard.png', { type: 'image/png' }),
    ])

    expect(handleClipboardImagePaste({}, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
  })

  it('leaves paste inside text editors alone', () => {
    const input = document.createElement('textarea')
    const event = pasteEvent(input, [new File(['image'], 'clipboard.png', { type: 'image/png' })])

    expect(handleClipboardImagePaste({}, event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(uploadBlobNamed).not.toHaveBeenCalled()
  })

  it('leaves non-image clipboard data alone', () => {
    const event = pasteEvent(document.body, [new File(['text'], 'notes.txt', { type: 'text/plain' })])

    expect(handleClipboardImagePaste({}, event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(uploadBlobNamed).not.toHaveBeenCalled()
  })
})
