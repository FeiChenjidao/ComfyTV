import { reactive } from 'vue'

import type { Asset } from '../../../api/schemas/asset'
import { ASSET_DRAG_MIME, parseAssetDragIds } from '../../../composables/sidebar/assetCanvasDrop'
import { importAssetFiles } from '../../../composables/sidebar/assetImport'
import { useAssetStore } from '../../../stores/assetStore'

export interface AgentAssetAttachment {
  id: string
  name: string
  ref: string
  previewUrl?: string
}

export const ATTACHABLE_MEDIA = ['image', 'video', 'audio']

export function assetRef(id: number): string {
  return `asset:${id}`
}

export function assetIdOf(ref: string): number | null {
  const m = /^asset:(\d+)$/.exec(ref)
  return m ? Number(m[1]) : null
}

export function toAttachment(asset: Asset): AgentAssetAttachment {
  return { id: assetRef(asset.id), name: asset.name, ref: assetRef(asset.id), previewUrl: asset.payload_url }
}

interface PickerHandlers {
  addedIds: () => number[]
  select: (asset: Asset) => void
  deselect: (asset: Asset) => void
}

export const assetPicker = reactive<{ open: boolean; handlers: PickerHandlers | null }>({
  open: false,
  handlers: null,
})

export function openAssetPicker(handlers: PickerHandlers): void {
  const store = useAssetStore()
  store.ensureHydrated()
  store.installWebSocketSync()
  assetPicker.handlers = handlers
  assetPicker.open = true
}

export function closeAssetPicker(): void {
  assetPicker.open = false
  assetPicker.handlers = null
}

export async function uploadToLibrary(file: File): Promise<{ ref: string; url: string }> {
  const [created] = await importAssetFiles([file])
  if (!created) throw new Error(`${file.name}: not an image, video or audio file`)
  return { ref: assetRef(created.id), url: created.payload_url }
}

export function isComfyTVAssetDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return !!dataTransfer && [...dataTransfer.types].includes(ASSET_DRAG_MIME)
}

export function droppedComfyTVAssets(dataTransfer: DataTransfer): AgentAssetAttachment[] {
  const store = useAssetStore()
  return parseAssetDragIds(dataTransfer.getData(ASSET_DRAG_MIME))
    .map((id) => store.byId(id))
    .filter((asset): asset is Asset => !!asset && ATTACHABLE_MEDIA.includes(asset.media_type))
    .map(toAttachment)
}
