import type { DirectorClip } from './useDirectorTimeline'

export type RefKind = 'images' | 'videos' | 'audio'

export const REF_KINDS = [
  { key: 'images' as const, mention: 'image', media: 'image' as const, info: 'image' as const },
  { key: 'videos' as const, mention: 'video', media: 'video' as const, info: 'video' as const },
  { key: 'audio' as const, mention: 'audio', media: 'audio' as const, info: 'audio' as const },
]

export interface ClipRefEntry {
  kind: RefKind
  url: string
  i: number
  m: number
}

export type SharedUrls = Record<RefKind, string[]>

export function refCount(clip: DirectorClip): number {
  return clip.images.length + clip.videos.length + clip.audio.length
}
