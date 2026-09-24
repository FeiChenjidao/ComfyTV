import type { MediaKind } from '../schemas/mediaAssetSchema'

export function iconForMediaType(mediaType: MediaKind): string {
  switch (mediaType) {
    case 'video':
      return 'ctv:icon-[lucide--video]'
    case 'audio':
      return 'ctv:icon-[lucide--music]'
    case '3D':
      return 'ctv:icon-[lucide--box]'
    case 'text':
      return 'ctv:icon-[lucide--text]'
    case 'other':
      return 'ctv:icon-[lucide--check-check]'
    default:
      return 'ctv:icon-[lucide--image]'
  }
}
