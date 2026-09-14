import { toImagePoolJson } from '@/stores/stageStore'

export const IMAGES_SPLIT_MAX = 32
export const IMAGES_SPLIT_CLASS = 'ComfyTV.ImagesSplitStage'
export const IMAGES_SPLIT_TYPE = 'COMFYTV_IMAGE'

export interface ImageGroupItem {
  index: string
  label: string
  image_url: string
}

export function parseImageGroupItems(raw: string | null | undefined): ImageGroupItem[] {
  const json = toImagePoolJson(raw)
  let images: Array<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(json)
    images = Array.isArray(parsed?.images) ? parsed.images : []
  } catch {
    images = []
  }
  const out: ImageGroupItem[] = []
  for (let i = 0; i < images.length; i++) {
    const im = images[i] ?? {}
    const url = String(im.image_url ?? im.url ?? '').trim()
    if (!url) continue
    const label = String(im.label ?? im.name ?? '').trim() || `Layer ${out.length + 1}`
    out.push({
      index: String(im.index ?? out.length + 1),
      label,
      image_url: url,
    })
  }
  return out
}

function uniqueOutputName(label: string, used: Set<string>, fallback: string): string {
  const base = label.trim() || fallback
  let name = base
  let n = 2
  while (used.has(name)) name = `${base} (${n++})`
  used.add(name)
  return name
}

export function syncImagesSplitOutputs(node: any, items: ImageGroupItem[]) {
  if (!node) return
  const n = Math.max(1, Math.min(items.length, IMAGES_SPLIT_MAX))
  if (!Array.isArray(node.outputs)) node.outputs = []

  while (node.outputs.length > n) {
    if (typeof node.removeOutput === 'function') node.removeOutput(node.outputs.length - 1)
    else node.outputs.pop()
  }

  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    const fallback = `image${i + 1}`
    const label = uniqueOutputName(items[i]?.label || '', used, fallback)
    if (i >= node.outputs.length) {
      if (typeof node.addOutput === 'function') {
        node.addOutput(label, IMAGES_SPLIT_TYPE, { label, localized_name: label })
      } else {
        node.outputs.push({ name: label, type: IMAGES_SPLIT_TYPE, label, localized_name: label, links: [] })
      }
      continue
    }
    const slot = node.outputs[i]
    slot.name = label
    slot.label = label
    slot.localized_name = label
    if (slot.type == null || slot.type === '') slot.type = IMAGES_SPLIT_TYPE
  }
  node.setDirtyCanvas?.(true, true)
  compactImagesSplitNode(node, n)
}

export function splitImageGroup(raw: string | null | undefined): {
  items: ImageGroupItem[]
  truncated: boolean
} {
  const parsed = parseImageGroupItems(raw)
  return {
    items: parsed.slice(0, IMAGES_SPLIT_MAX),
    truncated: parsed.length > IMAGES_SPLIT_MAX,
  }
}

/** Keep LiteGraph outputs and stage snapshots in sync with the incoming image group. */
export function syncImagesSplitStage(
  node: any,
  raw: string | null | undefined,
  writeSlots: (urls: Array<string | null>) => void,
): { items: ImageGroupItem[]; truncated: boolean } {
  const { items, truncated } = splitImageGroup(raw)
  syncImagesSplitOutputs(node, items)
  writeSlots(Array.from({ length: IMAGES_SPLIT_MAX }, (_, i) => items[i]?.image_url ?? null))
  return { items, truncated }
}

export function imagesSplitUrlAt(
  state: {
    outputs?: Array<string | null>
    inputs?: Array<{ slot?: string; content?: string | null }>
  } | null | undefined,
  slot: number,
): string | null {
  const slotted = state?.outputs?.[slot]
  if (slotted != null && String(slotted).length > 0) return String(slotted)
  const raw = state?.inputs?.find(i => i.slot === 'images')?.content
  return parseImageGroupItems(raw)[slot]?.image_url ?? null
}

const IMAGES_SPLIT_MIN_W = 360
const IMAGES_SPLIT_MIN_H = 680
const IMAGES_SPLIT_MAX_H = 800
const IMAGES_SPLIT_STRETCH_H = 840

export function compactImagesSplitNode(node: any, itemCount: number) {
  if (typeof node?.setSize !== 'function') return
  const w = Math.max(Number(node.size?.[0]) || IMAGES_SPLIT_MIN_W, IMAGES_SPLIT_MIN_W)
  const h = Number(node.size?.[1]) || 0
  const rows = Math.min(Math.max(itemCount, 1), 2)
  const want = Math.max(IMAGES_SPLIT_MIN_H, Math.min(IMAGES_SPLIT_MAX_H, 160 + rows * 280))
  if (h < want - 8 || h > IMAGES_SPLIT_STRETCH_H) {
    node.setSize([w, want])
    node.setDirtyCanvas?.(true, true)
  }
}

export function rangeSelectIndexes(order: number[], from: number, to: number): number[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0) return b < 0 ? [] : [to]
  if (b < 0) return [from]
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return order.slice(lo, hi + 1)
}

export function itemsInDocumentOrder(items: ImageGroupItem[], indexes: Iterable<number>): ImageGroupItem[] {
  const want = new Set(indexes)
  return items.filter((_, i) => want.has(i))
}

type SizedImage = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }

export function layerImageSize(im: SizedImage): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(Number(im.naturalWidth ?? im.width) || 1)),
    h: Math.max(1, Math.round(Number(im.naturalHeight ?? im.height) || 1)),
  }
}

/** Bottom-to-top source-over. Same-size PSD crops stay aligned at (0, 0). */
export function compositeLayerImages(images: SizedImage[]): HTMLCanvasElement {
  const out = document.createElement('canvas')
  if (!images.length) {
    out.width = 1
    out.height = 1
    return out
  }
  let w = 1
  let h = 1
  for (const im of images) {
    const s = layerImageSize(im)
    if (s.w > w) w = s.w
    if (s.h > h) h = s.h
  }
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) return out
  for (const im of images) ctx.drawImage(im, 0, 0)
  return out
}
