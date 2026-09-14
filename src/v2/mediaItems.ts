import type { StageState } from '@/stores/stageStore'

export interface MediaItem { url: string; label: string }
export type MediaSource = 'batch' | 'pool'

type MediaState = Pick<StageState, 'output' | 'pool' | 'pickedIndex'>

export function mediaItems(state: Pick<MediaState, 'output' | 'pool'>, source: MediaSource): MediaItem[] {
  const raw = source === 'pool' ? state.pool : state.output
  const str = String(raw ?? '')
  if (!str) return []
  try {
    const data = JSON.parse(str)
    const images = Array.isArray(data?.images) ? data.images : []
    const cells = images
      .map((im: any) => ({ url: String(im?.image_url ?? ''), label: String(im?.label ?? '') }))
      .filter((c: MediaItem) => c.url)
    if (cells.length) return cells
  } catch { }
  return source === 'batch' && !str.trim().startsWith('{')
    ? [{ url: str, label: '' }]
    : []
}

export function pickedMediaIndex(state: Pick<MediaState, 'pickedIndex'>, count: number): number {
  const i = Number(state.pickedIndex)
  return Math.min(Math.max(Number.isFinite(i) && i >= 1 ? i : 1, 1), Math.max(count, 1))
}

export function pickedMediaItem(state: MediaState, source: MediaSource): MediaItem | null {
  const items = mediaItems(state, source)
  return items[pickedMediaIndex(state, items.length) - 1] ?? null
}

/** First displayable still from a slot payload (plain URL or `{ images: [...] }` batch). */
export function previewUrlFromPayload(raw: string | null | undefined): string | null {
  return mediaItems({ output: raw ?? null, pool: null }, 'batch')[0]?.url ?? null
}

function slotContent(state: Pick<StageState, 'inputs'>, slot: string): string {
  const raw = state.inputs?.find(i => i.slot === slot)?.content
  return typeof raw === 'string' ? raw.trim() : ''
}

export interface LodPosterOpts {
  /** Custom Split: keep the full source, not the first crop after execute. */
  preferImageInput?: boolean
}

/** Poster URL when zoomed out: output/pool, else connected still, else first image-group cell. */
export function lodPosterUrl(
  state: StageState,
  source: MediaSource,
  opts?: LodPosterOpts,
): string {
  if (opts?.preferImageInput) {
    const imageIn = slotContent(state, 'image')
    if (imageIn && !imageIn.startsWith('{')) return imageIn
  }
  const picked = pickedMediaItem(state, source)?.url ?? ''
  if (picked) return picked
  const imageIn = slotContent(state, 'image')
  if (imageIn && !imageIn.startsWith('{')) return imageIn
  const group = slotContent(state, 'images')
  if (!group) return ''
  return mediaItems({ output: group, pool: null }, 'batch')[0]?.url ?? ''
}
