import type { StageState } from '@/stores/stageStore'
import { outputImageUrl } from '@/v2/imageToolbar'

type ToastSeverity = 'success' | 'error'

export interface ClipboardImageCopyOptions {
  resolveStageState: (node: object) => StageState | undefined
  resolveUrl: (url: string) => string
  toast?: (severity: ToastSeverity, summary: string, detail?: string) => void
  successMessage?: string
  failureMessage?: string
  unavailableMessage?: string
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null
}

function selectedNodes(host: any): any[] {
  const selected = host?.canvas?.selected_nodes
  if (!selected) return []
  if (selected instanceof Map) return Array.from(selected.values())
  if (typeof selected[Symbol.iterator] === 'function') return Array.from(selected)
  return Object.values(selected)
}

function hasSelectedText(): boolean {
  const selection = window.getSelection?.()
  return !!selection && !selection.isCollapsed && !!selection.toString()
}

function imageOutputUrl(state: StageState | undefined): string {
  if (!state) return ''
  if (!['COMFYTV_IMAGE', 'COMFYTV_IMAGES', 'COMFYTV_PANORAMA'].includes(state.outputType)) return ''
  return outputImageUrl(state)
}

async function blobAsPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob

  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        png => png ? resolve(png) : reject(new Error('PNG conversion failed')),
        'image/png',
      )
    })
  } finally {
    bitmap.close()
  }
}

export async function copyImageUrlToClipboard(
  url: string,
  resolveUrl: (url: string) => string,
): Promise<void> {
  const ClipboardItemCtor = globalThis.ClipboardItem
  if (!navigator.clipboard?.write || !ClipboardItemCtor || !window.isSecureContext) {
    throw new Error('IMAGE_CLIPBOARD_UNAVAILABLE')
  }

  const png = fetch(resolveUrl(url)).then(async (response) => {
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`)
    return blobAsPng(await response.blob())
  })
  await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': png })])
}

export function handleClipboardImageCopy(
  host: any,
  event: KeyboardEvent,
  options: ClipboardImageCopyOptions,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'c') return false
  if (isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement)) return false
  if (hasSelectedText()) return false

  const nodes = selectedNodes(host)
  if (nodes.length !== 1) return false
  const url = imageOutputUrl(options.resolveStageState(nodes[0]))
  if (!url) return false

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()

  void copyImageUrlToClipboard(url, options.resolveUrl).then(() => {
    options.toast?.('success', options.successMessage ?? 'Image copied')
  }).catch((error) => {
    console.error('[ComfyTV/clipboard] image copy failed', error)
    const unavailable = error instanceof Error && error.message === 'IMAGE_CLIPBOARD_UNAVAILABLE'
    options.toast?.(
      'error',
      options.failureMessage ?? 'Image copy failed',
      unavailable ? options.unavailableMessage : String(error instanceof Error ? error.message : error),
    )
  })
  return true
}

let installed = false

export function installClipboardImageCopy(host: any, options: ClipboardImageCopyOptions): void {
  if (installed) return
  installed = true
  window.addEventListener('keydown', event => handleClipboardImageCopy(host, event, options), true)
}
