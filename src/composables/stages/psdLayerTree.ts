import type { GroupData, RasterData, SceneNode } from '@jtydhr88/pentrado'

export const PSD_ROOT_ID = '__root__'

/** Soft browser safety only — used by OOM retry, not a proactive downscale cap. */
export const MAX_COMPOSITE_DIM = 16384

/**
 * Cap for the on-screen preview only. Full-resolution composite is still uploaded
 * to `captured_image` / stage outputs for downstream nodes.
 */
export const PREVIEW_DISPLAY_MAX_DIM = 2048

export interface PsdTreeRow {
  id: string
  name: string
  kind: string
  depth: number
  visible: boolean
  hasChildren: boolean
  warning: boolean
  clip: boolean
}

export type ContentMap = Map<string, HTMLCanvasElement>

export interface FitSize {
  width: number
  height: number
  scale: number
}

const WARN_KINDS = new Set(['adjustment', 'text', 'vector', 'fill'])

const BLEND_TO_GCO: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
}

export function flattenPsdTree(nodes: SceneNode[], rootName = 'Document'): PsdTreeRow[] {
  const out: PsdTreeRow[] = [{
    id: PSD_ROOT_ID,
    name: rootName,
    kind: 'document',
    depth: 0,
    visible: true,
    hasChildren: nodes.length > 0,
    warning: false,
    clip: false,
  }]
  function walk(list: SceneNode[], depth: number) {
    for (const n of list) {
      const kids = n.kind === 'group' ? (n as GroupData).children : []
      out.push({
        id: n.id,
        name: n.name || n.kind,
        kind: n.kind,
        depth,
        visible: n.visible,
        hasChildren: kids.length > 0,
        warning: WARN_KINDS.has(n.kind),
        clip: n.clip === true,
      })
      if (kids.length) walk(kids, depth + 1)
    }
  }
  walk(nodes, 1)
  return out
}

export function visibleTreeRows(rows: PsdTreeRow[], collapsed: Set<string>): PsdTreeRow[] {
  const hiddenDepth = { n: -1 }
  const out: PsdTreeRow[] = []
  for (const row of rows) {
    if (hiddenDepth.n >= 0 && row.depth > hiddenDepth.n) continue
    hiddenDepth.n = -1
    out.push(row)
    if (row.hasChildren && collapsed.has(row.id)) hiddenDepth.n = row.depth
  }
  return out
}

/** Folders start closed so a deep PSD does not stretch the V2 window. */
export function defaultCollapsedIds(rows: PsdTreeRow[]): Set<string> {
  return new Set(rows.filter(r => r.hasChildren).map(r => r.id))
}

export function findSceneNode(nodes: SceneNode[], id: string): SceneNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.kind === 'group') {
      const hit = findSceneNode((n as GroupData).children, id)
      if (hit) return hit
    }
  }
  return null
}

export function isolateSubtree(nodes: SceneNode[], id: string): SceneNode[] {
  if (!id || id === PSD_ROOT_ID) return nodes
  const hit = findSceneNode(nodes, id)
  return hit ? [hit] : []
}

export function parseSelectedIds(raw: string | null | undefined): string[] {
  const s = String(raw ?? '').trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const v = JSON.parse(s)
      if (Array.isArray(v)) return [...new Set(v.map(x => String(x)).filter(Boolean))]
    } catch { /* fall through to single-id */ }
  }
  return [s]
}

export function serializeSelectedIds(ids: string[]): string {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length <= 1) return unique[0] ?? ''
  return JSON.stringify(unique)
}

/** Visible-row range for Shift-click. Missing anchors fall back to the click target. */
export function rangeSelectIds(visibleIds: string[], fromId: string, toId: string): string[] {
  const a = visibleIds.indexOf(fromId)
  const b = visibleIds.indexOf(toId)
  if (a < 0 || b < 0) return [toId].filter(Boolean)
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return visibleIds.slice(lo, hi + 1)
}

/**
 * Forest of selected subtrees in document order.
 * Selecting the document root wins. A selected ancestor drops selected descendants
 * so the same pixels are not composited twice.
 */
export function isolateSelected(nodes: SceneNode[], ids: string[]): SceneNode[] {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return []
  if (unique.includes(PSD_ROOT_ID)) return nodes

  const covered = new Set<string>()
  function collectDescendants(n: SceneNode) {
    if (n.kind !== 'group') return
    for (const c of (n as GroupData).children) {
      covered.add(c.id)
      collectDescendants(c)
    }
  }
  for (const id of unique) {
    const n = findSceneNode(nodes, id)
    if (n) collectDescendants(n)
  }
  const roots = new Set(unique.filter(id => !covered.has(id)))
  const out: SceneNode[] = []
  function walk(list: SceneNode[]) {
    for (const n of list) {
      if (roots.has(n.id)) {
        out.push(n)
        continue
      }
      if (n.kind === 'group') walk((n as GroupData).children)
    }
  }
  walk(nodes)
  return out
}

function isClipped(n: SceneNode): boolean {
  return n.clip === true
}

/** Photoshop clip base: nearest non-clipped sibling below (lower index). */
export function clipBaseOf(forest: SceneNode[], id: string): SceneNode | null {
  function walk(list: SceneNode[]): SceneNode | null {
    const idx = list.findIndex(n => n.id === id)
    if (idx >= 0) {
      if (!isClipped(list[idx])) return null
      let i = idx
      while (i > 0 && isClipped(list[i])) i--
      if (isClipped(list[i]) || list[i].id === id) return null
      return list[i]
    }
    for (const n of list) {
      if (n.kind === 'group') {
        const hit = walk((n as GroupData).children)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(forest)
}

function containsNode(list: SceneNode[], id: string): boolean {
  for (const n of list) {
    if (n.id === id) return true
    if (n.kind === 'group' && containsNode((n as GroupData).children, id)) return true
  }
  return false
}

/** Clip bases needed as alpha-only masks when the base is not in the isolated forest. */
export function collectClipMaskSources(forest: SceneNode[], isolated: SceneNode[]): SceneNode[] {
  const extra: SceneNode[] = []
  const seen = new Set<string>()
  function visit(n: SceneNode) {
    const base = clipBaseOf(forest, n.id)
    if (base && !containsNode(isolated, base.id) && !seen.has(base.id)) {
      seen.add(base.id)
      extra.push(base)
    }
    if (n.kind === 'group') {
      for (const c of (n as GroupData).children) visit(c)
    }
  }
  for (const n of isolated) visit(n)
  return extra
}

/** Duck-typed ag-psd layer; pixels are decoded later via getLayerCanvas. */
export interface PsdLayerLike {
  name?: string
  hidden?: boolean
  opacity?: number
  blendMode?: string
  clipping?: boolean
  left?: number
  top?: number
  right?: number
  bottom?: number
  children?: PsdLayerLike[]
  text?: unknown
  adjustment?: unknown
  vectorMask?: unknown
  vectorFill?: unknown
  mask?: { disabled?: boolean }
}

const LOCKS = { content: false, position: false, visibility: false }

function opacity01(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1
  if (n > 1) return Math.min(1, n / 255)
  return Math.min(1, Math.max(0, n))
}

function blendFromPsdName(mode: string | undefined): string {
  if (!mode || mode === 'pass through') return 'normal'
  return mode.replace(/ /g, '-')
}

function stubKind(layer: PsdLayerLike): PsdTreeRow['kind'] {
  if (layer.children) return 'group'
  if (layer.adjustment) return 'adjustment'
  if (layer.text) return 'text'
  if (layer.vectorMask) return 'vector'
  if (layer.vectorFill) return 'fill'
  return 'raster'
}

export function sceneFromPsdLayers(layers: PsdLayerLike[] | undefined): {
  nodes: SceneNode[]
  layerMap: Map<string, PsdLayerLike>
} {
  const layerMap = new Map<string, PsdLayerLike>()
  let seq = 0
  function walk(list: PsdLayerLike[]): SceneNode[] {
    const out: SceneNode[] = []
    for (const layer of list) {
      const id = `L${seq++}`
      layerMap.set(id, layer)
      const kind = stubKind(layer)
      const x = Number(layer.left) || 0
      const y = Number(layer.top) || 0
      const w = Math.max(1, (Number(layer.right) || 0) - x)
      const h = Math.max(1, (Number(layer.bottom) || 0) - y)
      const mode = { blend: blendFromPsdName(layer.blendMode) } as RasterData['mode']
      const base = {
        id,
        name: layer.name || kind,
        visible: !layer.hidden,
        opacity: opacity01(layer.opacity),
        mode,
        transform: { x, y, w, h, rotation: 0 },
        locks: LOCKS,
        clip: layer.clipping === true ? true : undefined,
      }
      if (kind === 'group') {
        out.push({
          ...base,
          kind: 'group',
          children: walk(layer.children ?? []),
          passThrough: layer.blendMode === 'pass through',
        } as GroupData)
        continue
      }
      if (kind === 'raster') {
        const raster: RasterData = {
          ...base,
          kind: 'raster',
          contentId: `c-${id}`,
          naturalWidth: w,
          naturalHeight: h,
        }
        if (layer.mask) {
          raster.mask = {
            id: `m-${id}`,
            role: 'mask',
            contentId: `m-${id}`,
            enabled: !layer.mask.disabled,
          }
        }
        out.push(raster)
        continue
      }
      out.push({ ...base, kind } as SceneNode)
    }
    return out
  }
  return { nodes: walk(layers ?? []), layerMap }
}

export function collectRasters(nodes: SceneNode[]): RasterData[] {
  const out: RasterData[] = []
  function walk(list: SceneNode[]) {
    for (const n of list) {
      if (n.kind === 'group') walk((n as GroupData).children)
      else if (n.kind === 'raster') out.push(n as RasterData)
    }
  }
  walk(nodes)
  return out
}

export function shouldAutoComposite(width: number, height: number, rasterCount: number): boolean {
  if (rasterCount <= 0 || rasterCount > 16) return false
  return width * height <= 2048 * 2048
}

export interface PixelBounds {
  x: number
  y: number
  w: number
  h: number
}

export function opaqueBounds(canvas: HTMLCanvasElement): PixelBounds | null {
  const w = canvas.width
  const h = canvas.height
  if (w <= 0 || h <= 0) return null
  const ctx = canvas.getContext('2d')
  if (!ctx?.getImageData) return null
  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, w, h)
  } catch {
    return null
  }
  const px = data.data
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (px[(row + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function mapBounds(
  b: PixelBounds,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): PixelBounds {
  if (srcW === dstW && srcH === dstH) return b
  const sx = dstW / Math.max(1, srcW)
  const sy = dstH / Math.max(1, srcH)
  const x = Math.max(0, Math.floor(b.x * sx))
  const y = Math.max(0, Math.floor(b.y * sy))
  const w = Math.max(1, Math.ceil(b.w * sx))
  const h = Math.max(1, Math.ceil(b.h * sy))
  return {
    x,
    y,
    w: Math.min(w, Math.max(1, dstW - x)),
    h: Math.min(h, Math.max(1, dstH - y)),
  }
}

export function cropCanvas(src: HTMLCanvasElement, bounds: PixelBounds): HTMLCanvasElement {
  const w = Math.max(1, Math.round(bounds.w))
  const h = Math.max(1, Math.round(bounds.h))
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')?.drawImage(src, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, w, h)
  return out
}

/** Crop `src` with a shared union bbox. Does not compute per-layer bounds. */
export function cropToBounds(
  src: HTMLCanvasElement,
  bounds: PixelBounds | null,
  fromW = src.width,
  fromH = src.height,
): HTMLCanvasElement {
  if (!bounds) return src
  const b = mapBounds(bounds, fromW, fromH, src.width, src.height)
  if (b.x === 0 && b.y === 0 && b.w === src.width && b.h === src.height) return src
  const out = cropCanvas(src, b)
  src.width = 0
  src.height = 0
  return out
}

export function shrinkCanvasInPlace(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (!(scale > 0) || scale >= 0.999) return src
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  if (w >= src.width && h >= src.height) return src
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  tmp.getContext('2d')?.drawImage(src, 0, 0, w, h)
  src.width = 0
  src.height = 0
  return tmp
}

/** Like shrinkCanvasInPlace but never destroys `src` (for cached full-res layers). */
export function shrinkCanvasCopy(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (!(scale > 0) || scale >= 0.999) return src
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  if (w >= src.width && h >= src.height) return src
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  tmp.getContext('2d')?.drawImage(src, 0, 0, w, h)
  return tmp
}

/** Build a scale-matched content map for a display/composite pass. */
export function scaleContentsMap(src: ContentMap, scale: number): ContentMap {
  if (!(scale > 0) || scale >= 0.999) return src
  const out: ContentMap = new Map()
  for (const [id, canvas] of src) {
    out.set(id, shrinkCanvasCopy(canvas, scale))
  }
  return out
}

/** Free canvases in `map` that are not shared with `keep`. */
export function releaseScaledContents(map: ContentMap, keep: ContentMap): void {
  if (map === keep) return
  for (const [id, canvas] of map) {
    if (keep.get(id) === canvas) continue
    canvas.width = 0
    canvas.height = 0
  }
  map.clear()
}

export function fitCompositeSize(width: number, height: number): FitSize {
  // Always prefer native document pixels. Downscale only happens reactively in
  // compositeSubtree when the browser throws a canvas memory error.
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  return { width: w, height: h, scale: 1 }
}

/** Fit a canvas into the preview budget without mutating the source. */
export function fitDisplaySize(
  width: number,
  height: number,
  maxDim = PREVIEW_DISPLAY_MAX_DIM,
): FitSize {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const long = Math.max(w, h)
  if (!(maxDim > 0) || long <= maxDim) return { width: w, height: h, scale: 1 }
  const scale = maxDim / long
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  }
}

/** Returns a new canvas when downscaling; otherwise returns `src` unchanged. */
export function scaleCanvasToMaxDim(
  src: HTMLCanvasElement,
  maxDim = PREVIEW_DISPLAY_MAX_DIM,
): HTMLCanvasElement {
  const fit = fitDisplaySize(src.width, src.height, maxDim)
  if (fit.scale >= 0.999) return src
  const out = document.createElement('canvas')
  out.width = fit.width
  out.height = fit.height
  out.getContext('2d')?.drawImage(src, 0, 0, fit.width, fit.height)
  return out
}

export function isMemoryError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /memory limit|maximum canvas|out of memory|allocation failed|exceeded/i.test(msg)
}

export function releaseContents(map: ContentMap): void {
  for (const c of map.values()) {
    c.width = 0
    c.height = 0
  }
  map.clear()
}

function blendOp(node: SceneNode): GlobalCompositeOperation {
  const blend = (node.mode as { blend?: string } | undefined)?.blend
  return BLEND_TO_GCO[blend ?? ''] ?? 'source-over'
}

class ScratchPool {
  private idle: HTMLCanvasElement[] = []

  acquire(width: number, height: number): HTMLCanvasElement {
    const c = this.idle.pop() ?? document.createElement('canvas')
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    } else {
      c.getContext('2d')?.clearRect(0, 0, w, h)
    }
    return c
  }

  release(c: HTMLCanvasElement): void {
    this.idle.push(c)
  }

  dispose(): void {
    for (const c of this.idle) {
      c.width = 0
      c.height = 0
    }
    this.idle.length = 0
  }
}

function drawRaster(
  ctx: CanvasRenderingContext2D,
  node: RasterData,
  contents: ContentMap,
  scale: number,
  pool: ScratchPool,
): void {
  const src = contents.get(node.contentId)
  if (!src) return
  const dx = node.transform.x * scale
  const dy = node.transform.y * scale
  const dw = Math.max(1, node.transform.w * scale)
  const dh = Math.max(1, node.transform.h * scale)
  const mask = node.mask?.enabled ? contents.get(node.mask.contentId) : undefined

  ctx.save()
  ctx.globalAlpha = Number.isFinite(node.opacity) ? node.opacity : 1
  ctx.globalCompositeOperation = blendOp(node)
  if (!mask) {
    ctx.drawImage(src, dx, dy, dw, dh)
    ctx.restore()
    return
  }
  const tmp = pool.acquire(dw, dh)
  const t = tmp.getContext('2d')
  if (t) {
    t.drawImage(src, 0, 0, dw, dh)
    t.globalCompositeOperation = 'destination-in'
    t.drawImage(mask, 0, 0, dw, dh)
    ctx.drawImage(tmp, dx, dy)
  }
  pool.release(tmp)
  ctx.restore()
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  contents: ContentMap,
  skipHidden: boolean,
  scale: number,
  pool: ScratchPool,
  forest: SceneNode[],
): void {
  if (skipHidden && !node.visible) return
  if (node.kind === 'group') {
    const g = node as GroupData
    if (g.passThrough) {
      drawSiblings(ctx, g.children, contents, skipHidden, scale, pool, forest)
      return
    }
    const tmp = pool.acquire(ctx.canvas.width, ctx.canvas.height)
    const t = tmp.getContext('2d')
    if (t) {
      drawSiblings(t, g.children, contents, skipHidden, scale, pool, forest)
      ctx.save()
      ctx.globalAlpha = Number.isFinite(g.opacity) ? g.opacity : 1
      ctx.globalCompositeOperation = blendOp(g)
      ctx.drawImage(tmp, 0, 0)
      ctx.restore()
    }
    pool.release(tmp)
    return
  }
  if (node.kind === 'raster') drawRaster(ctx, node as RasterData, contents, scale, pool)
}

function asClipBaseSource(node: SceneNode): SceneNode {
  return { ...node, opacity: 1, mode: { blend: 'normal' } as RasterData['mode'] }
}

function drawClipRun(
  ctx: CanvasRenderingContext2D,
  base: SceneNode,
  clipped: SceneNode[],
  contents: ContentMap,
  skipHidden: boolean,
  scale: number,
  pool: ScratchPool,
  forest: SceneNode[],
): void {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const baseC = pool.acquire(w, h)
  const overC = pool.acquire(w, h)
  const source = asClipBaseSource(base)
  const bctx = baseC.getContext('2d')
  const octx = overC.getContext('2d')
  if (bctx) drawNode(bctx, source, contents, skipHidden, scale, pool, forest)
  if (octx) {
    octx.drawImage(baseC, 0, 0)
    for (const c of clipped) drawNode(octx, c, contents, skipHidden, scale, pool, forest)
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(baseC, 0, 0)
    ctx.save()
    ctx.globalAlpha = Number.isFinite(base.opacity) ? base.opacity : 1
    ctx.globalCompositeOperation = blendOp(base)
    ctx.drawImage(overC, 0, 0)
    ctx.restore()
  }
  pool.release(overC)
  pool.release(baseC)
}

function drawClippedOrphan(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  contents: ContentMap,
  skipHidden: boolean,
  scale: number,
  pool: ScratchPool,
  forest: SceneNode[],
): void {
  const base = clipBaseOf(forest, node.id)
  if (!base || (skipHidden && !base.visible)) {
    if (!base) drawNode(ctx, node, contents, skipHidden, scale, pool, forest)
    return
  }
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const overC = pool.acquire(w, h)
  const maskC = pool.acquire(w, h)
  const octx = overC.getContext('2d')
  const mctx = maskC.getContext('2d')
  if (octx) drawNode(octx, node, contents, skipHidden, scale, pool, forest)
  if (mctx) drawNode(mctx, base, contents, false, scale, pool, forest)
  if (octx) {
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(maskC, 0, 0)
    ctx.drawImage(overC, 0, 0)
  }
  pool.release(maskC)
  pool.release(overC)
}

function drawSiblings(
  ctx: CanvasRenderingContext2D,
  children: SceneNode[],
  contents: ContentMap,
  skipHidden: boolean,
  scale: number,
  pool: ScratchPool,
  forest: SceneNode[],
): void {
  let i = 0
  while (i < children.length) {
    const node = children[i]
    if (isClipped(node)) {
      drawClippedOrphan(ctx, node, contents, skipHidden, scale, pool, forest)
      i++
      continue
    }
    let j = i + 1
    while (j < children.length && isClipped(children[j])) j++
    if (j === i + 1) {
      drawNode(ctx, node, contents, skipHidden, scale, pool, forest)
      i++
      continue
    }
    if (skipHidden && !node.visible) {
      i = j
      continue
    }
    drawClipRun(ctx, node, children.slice(i + 1, j), contents, skipHidden, scale, pool, forest)
    i = j
  }
}

export function compositeSubtree(
  width: number,
  height: number,
  nodes: SceneNode[],
  contents: ContentMap,
  skipHidden = true,
  forest?: SceneNode[],
  fitOverride?: FitSize,
): HTMLCanvasElement {
  const clipForest = forest ?? nodes
  let fit = fitOverride ?? fitCompositeSize(width, height)
  const pool = new ScratchPool()
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const out = document.createElement('canvas')
      try {
        out.width = fit.width
        out.height = fit.height
        const ctx = out.getContext('2d')
        if (!ctx) return out
        drawSiblings(ctx, nodes, contents, skipHidden, fit.scale, pool, clipForest)
        return out
      } catch (e) {
        out.width = 0
        out.height = 0
        if (attempt === 4 || !isMemoryError(e)) throw e
        fit = {
          width: Math.max(1, Math.floor(fit.width / 2)),
          height: Math.max(1, Math.floor(fit.height / 2)),
          scale: fit.scale / 2,
        }
      }
    }
  } finally {
    pool.dispose()
  }
  const fallback = document.createElement('canvas')
  fallback.width = 1
  fallback.height = 1
  return fallback
}
