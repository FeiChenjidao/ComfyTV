export type MediaKind = 'image' | 'video' | 'audio' | '3D' | 'text' | 'other'

export const MIME_ASSET_INFO = 'application/x-comfy-asset-info'

export interface DraggedAssetInfo {
  filename?: string
  display_name?: string
  subfolder?: string
  type?: string
  attachment_ref?: string
  media_kind?: MediaKind
  preview_url?: string
}

export function parseAssetInfo(dataTransfer: DataTransfer): DraggedAssetInfo | undefined {
  const raw = dataTransfer?.getData(MIME_ASSET_INFO)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as DraggedAssetInfo) : undefined
  } catch {
    return undefined
  }
}
