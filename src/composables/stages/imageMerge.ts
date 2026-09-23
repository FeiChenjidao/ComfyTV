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
export type MergeAspect = 'native' | '1:1'

export const MERGE_MODES: readonly MergeMode[] = ['layers', 'row']
export const MERGE_ASPECTS: readonly MergeAspect[] = ['native', '1:1']

type SizedImage = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }

export function parseMergeMode(raw: unknown): MergeMode {
  return raw === 'row' ? 'row' : 'layers'
}

export function parseMergeAspect(raw: unknown): MergeAspect {
  return raw === '1:1' ? '1:1' : 'native'
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

export function maxMergeImageIndex(
  inputs: Array<{ name?: string } | null | undefined> | null | undefined,
): number {
  let max = -1
  for (const inp of inputs ?? []) {
    const idx = parseAutogrowImageIndex(String(inp?.name || ''))
    if (idx != null) max = Math.max(max, idx)
  }
  return max
}

/**
 * Ensure numbered merge image inputs exist (`images.image0`…`images.imageN-1`),
 * plus one empty spare like Autogrow's "next" slot when under max.
 */
export function ensureMergeInputCount(node: any, count: number): void {
  if (!node || count <= 0) return
  if (!Array.isArray(node.inputs)) node.inputs = []
  const n = Math.min(Math.max(1, count), IMAGE_MERGE_MAX)
  for (let i = 0; i < n; i++) {
    if (findMergeImageSlot(node, i) >= 0) continue
    const name = `images.image${i}`
    if (typeof node.addInput === 'function') node.addInput(name, MERGE_IMAGE_TYPE)
    else node.inputs.push({ name, type: MERGE_IMAGE_TYPE, link: null })
  }
  if (n < IMAGE_MERGE_MAX && findMergeImageSlot(node, n) < 0) {
    const spare = `images.image${n}`
    if (typeof node.addInput === 'function') node.addInput(spare, MERGE_IMAGE_TYPE)
    else node.inputs.push({ name: spare, type: MERGE_IMAGE_TYPE, link: null })
  }
  ensureMergeImageSockets(node)
}

/** Highest index among linked image sockets (saved + live + graph links). */
export function linkedMergeImageMax(node: any, saved?: any[]): number {
  let linkedMax = -1
  for (const s of saved ?? []) {
    const idx = parseAutogrowImageIndex(String(s?.name || ''))
    if (idx != null && s?.link != null) linkedMax = Math.max(linkedMax, idx)
  }
  for (const inp of node?.inputs ?? []) {
    const idx = parseAutogrowImageIndex(String(inp?.name || ''))
    if (idx != null && inp?.link != null) linkedMax = Math.max(linkedMax, idx)
  }
  const links = node?.graph?.links
  if (links) {
    const all = typeof links.values === 'function'
      ? [...links.values()]
      : Object.values(links)
    for (const link of all) {
      if (!link || link.target_id !== node?.id) continue
      const slot = Number(link.target_slot)
      if (!Number.isInteger(slot) || slot < 0) continue
      const inp = node.inputs?.[slot]
      const idx = parseAutogrowImageIndex(String(inp?.name || ''))
      if (idx != null) linkedMax = Math.max(linkedMax, idx)
    }
  }
  return linkedMax
}

/**
 * Drop empty image sockets above the Autogrow strip (linked count + one spare).
 * Clears leftover image0…31 from the old fixed-socket schema without cutting wires.
 */
export function pruneMergeEmptyInputs(node: any, keepCount: number): void {
  if (!node || !Array.isArray(node.inputs)) return
  const keep = Math.min(Math.max(1, keepCount), IMAGE_MERGE_MAX)
  // Indices 0..keep-1 are used; index `keep` is the empty spare when under max.
  const maxKeepIdx = keep < IMAGE_MERGE_MAX ? keep : keep - 1
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const inp = node.inputs[i]
    const idx = parseAutogrowImageIndex(String(inp?.name || ''))
    if (idx == null || idx <= maxKeepIdx) continue
    if (inp?.link != null) continue
    if (typeof node.removeInput === 'function') node.removeInput(i)
    else node.inputs.splice(i, 1)
  }
}

/**
 * After LiteGraph configure, re-expand Autogrow slots and reattach links from
 * the saved payload so multi-wire merges survive refresh without shipping 32
 * empty sockets on every new node.
 *
 * Only linked sockets drive expansion — old fixed-schema saves listed image0…31
 * even when empty; counting those names used to reopen the full strip.
 */
export function restoreMergeInputsFromSaved(node: any, info: any): void {
  if (!node) return
  if (!Array.isArray(node.inputs)) node.inputs = []

  const saved = Array.isArray(info?.inputs) ? info.inputs : []
  const linkedMax = linkedMergeImageMax(node, saved)
  const need = Math.max(linkedMax + 1, 1)
  ensureMergeInputCount(node, need)

  for (const s of saved) {
    const name = String(s?.name || '')
    const idx = parseAutogrowImageIndex(name)
    if (idx == null) continue
    const linkId = s?.link
    if (linkId == null) continue
    const slot = findMergeImageSlot(node, idx)
    if (slot < 0) continue
    const inp = node.inputs[slot]
    if (!inp) continue
    inp.link = linkId
    const link = lookupGraphLink(node.graph, linkId)
    if (link) {
      link.target_id = node.id
      link.target_slot = slot
      link.type = MERGE_IMAGE_TYPE
    }
  }

  const g = node.graph
  const links = g?.links
  if (links) {
    const all = typeof links.values === 'function'
      ? [...links.values()]
      : Object.values(links)
    for (const link of all) {
      if (!link || link.target_id !== node.id) continue
      const slot = Number(link.target_slot)
      if (!Number.isInteger(slot) || slot < 0) continue
      const inp = node.inputs[slot]
      if (!inp) continue
      const idx = parseAutogrowImageIndex(String(inp.name || ''))
      if (idx == null) continue
      inp.link = link.id ?? link
      link.type = MERGE_IMAGE_TYPE
    }
  }

  pruneMergeEmptyInputs(node, need)
  ensureMergeImageSockets(node, g)
}

/** @deprecated use restoreMergeInputsFromSaved */
export function expandMergeInputsFromSaved(node: any, info: any): void {
  restoreMergeInputsFromSaved(node, info)
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

/** Contain-fit `im` into a `size`×`size` canvas (center pad, no crop). */
export function containFitSquare(im: SizedImage, size: number): HTMLCanvasElement {
  const side = Math.max(1, Math.round(size))
  const out = document.createElement('canvas')
  out.width = side
  out.height = side
  const ctx = out.getContext('2d')
  if (!ctx) return out
  const { w, h } = layerImageSize(im)
  const scale = Math.min(side / w, side / h)
  const dw = w * scale
  const dh = h * scale
  ctx.drawImage(im, (side - dw) / 2, (side - dh) / 2, dw, dh)
  return out
}

/** Expand a canvas to 1:1 using the longer side (transparent pad). */
export function padCanvasToSquare(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = Math.max(1, src.width | 0)
  const h = Math.max(1, src.height | 0)
  const side = Math.max(1, Math.max(w, h))
  if (w === side && h === side) return src
  const out = document.createElement('canvas')
  out.width = side
  out.height = side
  const ctx = out.getContext('2d')
  if (!ctx) return out
  ctx.drawImage(src, Math.floor((side - w) / 2), Math.floor((side - h) / 2))
  return out
}

function squareCellSize(images: SizedImage[]): number {
  let side = 1
  for (const im of images) {
    const { w, h } = layerImageSize(im)
    side = Math.max(side, Math.max(w, h))
  }
  return side
}

function layoutImagesRowSquare(images: SizedImage[], gap = 0): HTMLCanvasElement {
  if (!images.length) return layoutImagesRow(images, gap)
  const cell = squareCellSize(images)
  const squares = images.map(im => containFitSquare(im, cell))
  try {
    return layoutImagesRow(squares, gap)
  } finally {
    for (const c of squares) {
      c.width = 0
      c.height = 0
    }
  }
}

export function mergeImages(
  images: SizedImage[],
  mode: MergeMode,
  aspect: MergeAspect = 'native',
): HTMLCanvasElement {
  const m = parseMergeMode(mode)
  const a = parseMergeAspect(aspect)
  if (m === 'row') {
    return a === '1:1' ? layoutImagesRowSquare(images) : layoutImagesRow(images)
  }
  const stacked = compositeLayerImages(images)
  if (a !== '1:1') return stacked
  const squared = padCanvasToSquare(stacked)
  if (squared !== stacked) {
    stacked.width = 0
    stacked.height = 0
  }
  return squared
}

export function slotIndexesInDocumentOrder(
  items: ImageGroupItem[],
  indexes: Iterable<number>,
): number[] {
  const want = new Set(indexes)
  return items.map((_, i) => i).filter(i => want.has(i))
}
