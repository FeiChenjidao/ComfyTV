import { previewUrlFromPayload } from '@/v2/mediaItems'

import {
  compositeLayerImages,
  layerImageSize,
  type ImageGroupItem,
} from './imagesSplit'

export const IMAGE_MERGE_CLASS = 'ComfyTV.ImageMergeStage'
export const IMAGE_MERGE_MAX = 32
export const MERGE_IMAGE_TYPE = 'COMFYTV_IMAGE'

export type MergeMode = 'layers' | 'row'

export const MERGE_MODES: readonly MergeMode[] = ['layers', 'row']

type SizedImage = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }

export function parseMergeMode(raw: unknown): MergeMode {
  return raw === 'row' ? 'row' : 'layers'
}

/** Numbered image sockets only. The Autogrow group `images` is not an image. */
export function parseAutogrowImageIndex(slot: string): number | null {
  const s = String(slot || '')
  const m = /^(?:images\.)?image(\d+)$/.exec(s)
  return m ? Number(m[1]) : null
}

export function mergeImageSlotNames(index: number): string[] {
  return [`images.image${index}`, `image${index}`]
}

export function findMergeImageSlot(node: any, index: number): number {
  const inputs = node?.inputs
  if (!Array.isArray(inputs)) return -1
  for (const name of mergeImageSlotNames(index)) {
    const i = inputs.findIndex((inp: any) => String(inp?.name || '') === name)
    if (i >= 0) return i
  }
  return -1
}

function lookupGraphLink(graph: any, id: unknown): any {
  const links = graph?.links
  if (!links) return graph?.getLink?.(id) ?? null
  if (typeof links.get === 'function') return links.get(id) ?? null
  return links[id as any] ?? null
}

/** Stamp COMFYTV_IMAGE on numbered merge inputs so wires paint green. */
export function ensureMergeImageSockets(node: any, graph?: any): void {
  const inputs = node?.inputs
  if (!Array.isArray(inputs)) return
  const g = graph ?? node?.graph
  for (const inp of inputs) {
    const name = String(inp?.name || '')
    if (name === 'images') continue
    if (parseAutogrowImageIndex(name) == null) continue
    inp.type = MERGE_IMAGE_TYPE
    if (inp.link == null || !g) continue
    const link = lookupGraphLink(g, inp.link)
    if (link) link.type = MERGE_IMAGE_TYPE
  }
}

export function collectMergeUrls(
  inputs: Array<{ slot?: string; content?: string | null; source?: string }> | null | undefined,
): string[] {
  const byIndex = new Map<number, string>()
  for (const inp of inputs ?? []) {
    const idx = parseAutogrowImageIndex(String(inp.slot || ''))
    if (idx == null) continue
    const url = previewUrlFromPayload(inp.content)
    if (!url) continue
    byIndex.set(idx, url)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, url]) => url)
    .slice(0, IMAGE_MERGE_MAX)
}

export function countLinkedMergeSlots(
  inputs: Array<{ slot?: string; name?: string; source?: string; link?: unknown }> | null | undefined,
): number {
  const seen = new Set<number>()
  for (const inp of inputs ?? []) {
    const idx = parseAutogrowImageIndex(String(inp.slot || inp.name || ''))
    if (idx == null) continue
    const linked = inp.link != null || (inp.source != null && inp.source !== 'empty')
    if (!linked) continue
    seen.add(idx)
  }
  return seen.size
}

export function collectMergeUrlsFromSources(opts: {
  inputs?: Array<{ slot?: string; content?: string | null; source?: string }> | null
  nodeInputs?: Array<{ name?: string; link?: unknown }> | null
  resolveLink?: (linkId: unknown) => string | null
}): string[] {
  const byIndex = new Map<number, string>()
  const put = (slot: string, raw: string | null | undefined) => {
    const idx = parseAutogrowImageIndex(slot)
    if (idx == null) return
    const url = previewUrlFromPayload(raw) ?? (raw && !String(raw).startsWith('{') ? String(raw) : null)
    if (!url) return
    if (!byIndex.has(idx)) byIndex.set(idx, url)
  }
  for (const inp of opts.inputs ?? []) put(String(inp.slot || ''), inp.content)
  for (const inp of opts.nodeInputs ?? []) {
    const name = String(inp.name || '')
    const idx = parseAutogrowImageIndex(name)
    if (idx == null || inp.link == null || byIndex.has(idx)) continue
    put(name, opts.resolveLink?.(inp.link) ?? null)
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, url]) => url)
    .slice(0, IMAGE_MERGE_MAX)
}

export function uniqueSlotIndexes(indexes: Iterable<number>): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const i of indexes) {
    if (!Number.isInteger(i) || i < 0 || seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  return out
}

export function layoutImagesRow(images: SizedImage[], gap = 0): HTMLCanvasElement {
  const out = document.createElement('canvas')
  if (!images.length) {
    out.width = 1
    out.height = 1
    return out
  }
  const sizes = images.map(layerImageSize)
  const w = sizes.reduce((sum, s) => sum + s.w, 0) + gap * Math.max(0, images.length - 1)
  const h = Math.max(...sizes.map(s => s.h))
  out.width = Math.max(1, w)
  out.height = Math.max(1, h)
  const ctx = out.getContext('2d')
  if (!ctx) return out
  let x = 0
  for (let i = 0; i < images.length; i++) {
    ctx.drawImage(images[i], x, 0)
    x += sizes[i].w + gap
  }
  return out
}

export function mergeImages(images: SizedImage[], mode: MergeMode): HTMLCanvasElement {
  return parseMergeMode(mode) === 'row'
    ? layoutImagesRow(images)
    : compositeLayerImages(images)
}

export function slotIndexesInDocumentOrder(
  items: ImageGroupItem[],
  indexes: Iterable<number>,
): number[] {
  const want = new Set(indexes)
  return items.map((_, i) => i).filter(i => want.has(i))
}
