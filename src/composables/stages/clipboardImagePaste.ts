import { toastLoaderUploadFailed } from '@/composables/stages/useLoaderFileDrop'
import { createNodeAt, IMAGE_LOADER_CLASS } from '@/composables/stages/spawnFollowUp'
import { app } from '@/lib/comfyApp'
import { uploadBlobNamed } from '@/utils/uploadCanvas'
import { getWidget, writeWidget } from '@/utils/widget'

const UPLOAD_SUBFOLDER = 'comfytv/uploads'

function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null
}

function cursorPosition(host: any): [number, number] {
  const cursor = host?.canvas?.graph_mouse
  return Array.isArray(cursor) && cursor.length >= 2
    ? [Number(cursor[0]) || 0, Number(cursor[1]) || 0]
    : [40, 40]
}

function selectedImageLoader(host: any): any | null {
  const selected = host?.canvas?.selected_nodes
  if (!selected) return null
  const nodes = typeof selected[Symbol.iterator] === 'function'
    ? Array.from(selected)
    : Object.values(selected)
  return nodes.length === 1 && (nodes[0] as any)?.comfyClass === IMAGE_LOADER_CLASS
    ? nodes[0]
    : null
}

async function uploadIntoNode(node: any, file: File, index: number): Promise<void> {
  const uploaded = await uploadBlobNamed(file, {
    subfolder: UPLOAD_SUBFOLDER,
    filename: file.name || `clipboard-${Date.now()}-${index}.png`,
  })
  const value = `${UPLOAD_SUBFOLDER}/${uploaded.name}`
  const widget = getWidget(node, 'image') as any
  const values = widget?.options?.values
  if (Array.isArray(values) && !values.includes(value)) values.push(value)
  writeWidget(node, 'image', value)
}

export async function pasteClipboardImages(host: any, files: File[]): Promise<any[]> {
  const origin = cursorPosition(host)
  const selected = selectedImageLoader(host)
  if (selected) {
    for (const [index, file] of files.entries()) await uploadIntoNode(selected, file, index)
    host?.graph?.setDirtyCanvas?.(true, true)
    return [selected]
  }

  const created: any[] = []

  for (const [index, file] of files.entries()) {
    const node = createNodeAt(IMAGE_LOADER_CLASS, [origin[0] + index * 32, origin[1] + index * 32])
    if (!node) continue
    await uploadIntoNode(node, file, index)
    created.push(node)
  }

  const last = created.at(-1)
  if (last) {
    host?.graph?.setDirtyCanvas?.(true, true)
    host?.canvas?.selectNode?.(last)
  }
  return created
}

export function handleClipboardImagePaste(host: any, event: ClipboardEvent): boolean {
  if (event.defaultPrevented || isTextEditingTarget(event.target)) return false
  const files = imageFiles(event.clipboardData)
  if (!files.length) return false

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  void pasteClipboardImages(host, files).catch((error) => {
    console.error('[ComfyTV/clipboard] image paste failed', error)
    toastLoaderUploadFailed(error)
  })
  return true
}

let installed = false

export function installClipboardImagePaste(host: any = app): void {
  if (installed) return
  installed = true
  document.addEventListener('paste', event => handleClipboardImagePaste(host, event), true)
}
