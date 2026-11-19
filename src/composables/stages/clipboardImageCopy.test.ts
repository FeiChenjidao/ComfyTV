import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StageState } from '@/stores/stageStore'
import { handleClipboardImageCopy } from './clipboardImageCopy'

function state(output: string | null, outputType = 'COMFYTV_IMAGE'): StageState {
  return {
    kind: 'image',
    variant: 'generator',
    outputType,
    output,
    outputs: [output],
    running: false,
    inputs: [],
    mainPrompt: '',
  } as StageState
}

function shortcut(target: EventTarget = document.body): KeyboardEvent {
  return {
    key: 'C',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent
}

describe('clipboard image copy shortcut', () => {
  const node = {}
  const toast = vi.fn()
  const write = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    toast.mockReset()
    write.mockReset()
    document.body.innerHTML = ''
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    vi.stubGlobal('ClipboardItem', class {
      data: Record<string, Blob | Promise<Blob>>
      constructor(data: Record<string, Blob | Promise<Blob>>) { this.data = data }
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new Blob(['png'], { type: 'image/png' }),
      { status: 200 },
    ))
    write.mockResolvedValue(undefined)
  })

  it('copies the selected image output on Ctrl+Shift+C', async () => {
    const event = shortcut()
    const handled = handleClipboardImageCopy(
      { canvas: { selected_nodes: { 1: node } } },
      event,
      {
        resolveStageState: () => state('/api/view?filename=result.png'),
        resolveUrl: url => `http://comfy.test${url.replace(/^\/api/, '')}`,
        toast,
      },
    )

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const item = write.mock.calls[0]![0][0]
    await expect(item.data['image/png']).resolves.toMatchObject({ type: 'image/png' })
    expect(fetch).toHaveBeenCalledWith('http://comfy.test/view?filename=result.png')
    expect(toast).toHaveBeenCalledWith('success', 'Image copied')
  })

  it('keeps plain Ctrl+C for normal node copying', () => {
    const event = shortcut()
    Object.defineProperty(event, 'shiftKey', { value: false })

    expect(handleClipboardImageCopy(
      { canvas: { selected_nodes: { 1: node } } },
      event,
      { resolveStageState: () => state('/image.png'), resolveUrl: url => url },
    )).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not claim the shortcut without a single image output', () => {
    const event = shortcut()
    expect(handleClipboardImageCopy(
      { canvas: { selected_nodes: { 1: node } } },
      event,
      { resolveStageState: () => state('/video.mp4', 'COMFYTV_VIDEO'), resolveUrl: url => url },
    )).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not override copying inside a text editor', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const event = shortcut(input)

    expect(handleClipboardImageCopy(
      { canvas: { selected_nodes: { 1: node } } },
      event,
      { resolveStageState: () => state('/image.png'), resolveUrl: url => url },
    )).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
