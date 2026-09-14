import { computed, ref, watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { useStageStore, type StageState } from '@/stores/stageStore'
import { uploadCanvas } from '@/utils/uploadCanvas'
import { getWidget, readWidgetStr, writeWidget } from '@/utils/widget'

import {
  displayedImageRect,
  MIN_DIVIDER_PX,
  type DisplayedImage,
} from './useGridSplit'

export { displayedImageRect, MIN_DIVIDER_PX }
export type { DisplayedImage }

/** Visible hairline. Hit target is wider so the line stays easy to drag. */
export const SPLIT_LINE_PX = 2
export const SPLIT_HIT_PX = 10

const SCHEDULE_DELAY_MS = 250
export const MIN_SPLIT_GAP = 0.01
export const MAX_SPLITS = 9
export const DEFAULT_V_SPLITS = [0.5]
export const DEFAULT_H_SPLITS: number[] = []

export type SplitAxis = 'v' | 'h'
export interface SelectedSplit {
  axis: SplitAxis
  index: number
}
export interface SplitCell {
  x: number
  y: number
  w: number
  h: number
  row: number
  col: number
  index: number
  label: string
}

/** Canonical turnaround names — also the texture-group output order. */
export const FACE_LABELS = ['正', '左', '背', '右'] as const
export type FaceLabel = typeof FACE_LABELS[number]

export const CUSTOM_SPLIT_CLASS = 'ComfyTV.CustomSplitStage'
export const CUSTOM_SPLIT_IMAGE_TYPE = 'COMFYTV_IMAGE'
export const CUSTOM_SPLIT_IMAGES_TYPE = 'COMFYTV_IMAGES'
export const CUSTOM_SPLIT_MAX_TILES = 32
export const MODEL3D_CLASS = 'ComfyTV.Model3DStage'

export function sortedUnique(splits: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const n of [...splits].sort((a, b) => a - b)) {
    const t = Math.round(n * 1e6) / 1e6
    if (!Number.isFinite(t) || t <= 0 || t >= 1) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_SPLITS) break
  }
  return out
}

export function parseSplits(raw: string | null | undefined, fallback: number[] = []): number[] {
  if (raw == null || String(raw).trim() === '') return [...fallback]
  try {
    const v = JSON.parse(String(raw))
    if (!Array.isArray(v)) return [...fallback]
    return sortedUnique(v.map(Number))
  } catch {
    return [...fallback]
  }
}

export function serializeSplits(splits: number[]): string {
  return JSON.stringify(sortedUnique(splits))
}

export function edgesFromSplits(splits: number[]): number[] {
  return [0, ...sortedUnique(splits), 1]
}

export function clampSplit(value: number, prev: number, next: number): number {
  const lo = prev + MIN_SPLIT_GAP
  const hi = next - MIN_SPLIT_GAP
  if (hi < lo) return (prev + next) / 2
  return Math.min(hi, Math.max(lo, value))
}

export function setSplitAt(splits: number[], index: number, value: number): number[] {
  const cur = sortedUnique(splits)
  if (index < 0 || index >= cur.length) return cur
  const prev = index === 0 ? 0 : cur[index - 1]!
  const next = index === cur.length - 1 ? 1 : cur[index + 1]!
  const nextArr = [...cur]
  nextArr[index] = clampSplit(value, prev, next)
  return sortedUnique(nextArr)
}

export function removeSplitAt(splits: number[], index: number): number[] {
  const cur = sortedUnique(splits)
  if (index < 0 || index >= cur.length) return cur
  return cur.filter((_, i) => i !== index)
}

export function insertInLargestGap(splits: number[]): number[] | null {
  const cur = sortedUnique(splits)
  if (cur.length >= MAX_SPLITS) return null
  const e = edgesFromSplits(cur)
  let bestI = 0
  let bestGap = -1
  for (let i = 0; i < e.length - 1; i++) {
    const g = e[i + 1]! - e[i]!
    if (g > bestGap) {
      bestGap = g
      bestI = i
    }
  }
  if (bestGap < MIN_SPLIT_GAP * 2) return null
  const mid = (e[bestI]! + e[bestI + 1]!) / 2
  return sortedUnique([...cur, mid])
}

export function cellsFromSplits(
  vSplits: number[],
  hSplits: number[],
  natW: number,
  natH: number,
): SplitCell[] {
  const xs = edgesFromSplits(vSplits).map(t => Math.round(t * natW))
  const ys = edgesFromSplits(hSplits).map(t => Math.round(t * natH))
  xs[xs.length - 1] = natW
  ys[ys.length - 1] = natH
  const cells: SplitCell[] = []
  let n = 0
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      n++
      const x = xs[c]!
      const y = ys[r]!
      const w = Math.max(1, xs[c + 1]! - x)
      const h = Math.max(1, ys[r + 1]! - y)
      cells.push({ x, y, w, h, row: r, col: c, index: n, label: `R${r + 1}C${c + 1}` })
    }
  }
  return cells
}

export function isFaceLabel(value: string): value is FaceLabel {
  return (FACE_LABELS as readonly string[]).includes(value)
}

export function resizeCellLabels(labels: string[], count: number): string[] {
  const n = Math.max(0, count)
  const next = labels.slice(0, n).map(v => (isFaceLabel(v) ? v : ''))
  while (next.length < n) next.push('')
  return next
}

export function parseCellLabels(raw: string | null | undefined, count: number): string[] {
  if (raw == null || String(raw).trim() === '') return resizeCellLabels([], count)
  try {
    const v = JSON.parse(String(raw))
    if (!Array.isArray(v)) return resizeCellLabels([], count)
    return resizeCellLabels(v.map(x => String(x ?? '')), count)
  } catch {
    return resizeCellLabels([], count)
  }
}

export function serializeCellLabels(labels: string[]): string {
  return JSON.stringify(labels.map(v => (isFaceLabel(v) ? v : '')))
}

export function assignFaceLabel(labels: string[], index: number, name: string): string[] {
  const next = [...labels]
  if (index < 0 || index >= next.length) return next
  const face = isFaceLabel(name) ? name : ''
  if (face) {
    for (let i = 0; i < next.length; i++) {
      if (i !== index && next[i] === face) next[i] = ''
    }
  }
  next[index] = face
  return next
}

/** If nothing is labeled yet, stamp 正/左/背/右 onto the first N cells (N = min(count, 4)). */
export function ensureFaceLabels(labels: string[], count: number): string[] {
  const next = resizeCellLabels(labels, count)
  if (next.some(isFaceLabel)) return next
  for (let i = 0; i < Math.min(count, FACE_LABELS.length); i++) {
    next[i] = FACE_LABELS[i]!
  }
  return next
}

export function cycleFaceLabel(labels: string[], index: number): string[] {
  const current = labels[index] || ''
  const at = FACE_LABELS.indexOf(current as FaceLabel)
  const nextName = at < 0 ? FACE_LABELS[0]! : (FACE_LABELS[at + 1] ?? '')
  return assignFaceLabel(labels, index, nextName)
}

export function faceRank(label: string): number {
  const i = FACE_LABELS.indexOf(label as FaceLabel)
  return i >= 0 ? i : FACE_LABELS.length
}

export function orderByFaceLabels<T>(items: T[], getLabel: (item: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, rank: faceRank(getLabel(item)) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(row => row.item)
}

function uniqueOutputName(label: string, used: Set<string>, fallback: string): string {
  const base = label.trim() || fallback
  let name = base
  let n = 2
  while (used.has(name)) name = `${base} (${n++})`
  used.add(name)
  return name
}

/** Slot 0 stays the image-group batch; slots 1..N are per-tile COMFYTV_IMAGE named by label. */
export function syncCustomSplitOutputs(
  node: any,
  items: Array<{ label: string; image_url?: string }>,
) {
  if (!node) return
  if (!Array.isArray(node.outputs)) node.outputs = []

  if (!node.outputs[0]) {
    if (typeof node.addOutput === 'function') {
      node.addOutput('images', CUSTOM_SPLIT_IMAGES_TYPE, {
        label: 'images', localized_name: 'images',
      })
    } else {
      node.outputs.push({
        name: 'images', type: CUSTOM_SPLIT_IMAGES_TYPE,
        label: 'images', localized_name: 'images', links: [],
      })
    }
  } else {
    const batch = node.outputs[0]
    batch.name = 'images'
    batch.label = 'images'
    batch.localized_name = 'images'
    batch.type = CUSTOM_SPLIT_IMAGES_TYPE
  }

  const n = Math.max(0, Math.min(items.length, CUSTOM_SPLIT_MAX_TILES))
  while (node.outputs.length > n + 1) {
    if (typeof node.removeOutput === 'function') node.removeOutput(node.outputs.length - 1)
    else node.outputs.pop()
  }

  const used = new Set<string>(['images', 'image'])
  for (let i = 0; i < n; i++) {
    const fallback = `image${i + 1}`
    const label = uniqueOutputName(items[i]?.label || '', used, fallback)
    const slot = i + 1
    if (slot >= node.outputs.length) {
      if (typeof node.addOutput === 'function') {
        node.addOutput(label, CUSTOM_SPLIT_IMAGE_TYPE, { label, localized_name: label })
      } else {
        node.outputs.push({
          name: label, type: CUSTOM_SPLIT_IMAGE_TYPE,
          label, localized_name: label, links: [],
        })
      }
      continue
    }
    const out = node.outputs[slot]
    out.name = label
    out.label = label
    out.localized_name = label
    out.type = CUSTOM_SPLIT_IMAGE_TYPE
  }
  node.setDirtyCanvas?.(true, true)
}

export function findCustomSplitTileSlot(node: any, label: string): number {
  const outs = node?.outputs
  if (!Array.isArray(outs)) return -1
  for (let i = 1; i < outs.length; i++) {
    if (String(outs[i]?.name || '') === label) return i
  }
  return -1
}

export function faceInputSlotNames(face: string): string[] {
  return [`images.${face}`, face]
}

export function findModel3DFaceSlot(node: any, face: string): number {
  const inputs = node?.inputs
  if (!Array.isArray(inputs)) return -1
  for (const name of faceInputSlotNames(face)) {
    const i = inputs.findIndex((inp: any) => String(inp?.name || '') === name)
    if (i >= 0) return i
  }
  return -1
}

export function cellOverlayStyle(
  cell: SplitCell,
  d: DisplayedImage,
  natW: number,
  natH: number,
): Record<string, string> {
  if (!(natW > 0) || !(natH > 0)) {
    return { left: '0px', top: '0px', width: '0px', height: '0px' }
  }
  return {
    left: `${d.ox + (cell.x / natW) * d.w}px`,
    top: `${d.oy + (cell.y / natH) * d.h}px`,
    width: `${(cell.w / natW) * d.w}px`,
    height: `${(cell.h / natH) * d.h}px`,
  }
}

export function splitBandStyle(
  axis: SplitAxis,
  d: DisplayedImage,
  t: number,
  thick = MIN_DIVIDER_PX,
): Record<string, string> {
  const w = Math.max(MIN_DIVIDER_PX, thick)
  if (axis === 'v') {
    return {
      left: `${d.ox + t * d.w - w / 2}px`,
      top: `${d.oy}px`,
      width: `${w}px`,
      height: `${d.h}px`,
    }
  }
  return {
    left: `${d.ox}px`,
    top: `${d.oy + t * d.h - w / 2}px`,
    width: `${d.w}px`,
    height: `${w}px`,
  }
}

export function fractionAlongAxis(
  axis: SplitAxis,
  clientX: number,
  clientY: number,
  container: { left: number; top: number },
  d: DisplayedImage,
): number | null {
  const x = clientX - container.left
  const y = clientY - container.top
  const t = axis === 'v' ? (x - d.ox) / d.w : (y - d.oy) / d.h
  if (!Number.isFinite(t)) return null
  return t
}

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/** Screen-space box of the painted image, including ComfyUI canvas zoom. */
export function imageScreenRect(
  img: { getBoundingClientRect: () => DOMRect } | null | undefined,
  container: HTMLElement | null | undefined,
  d: DisplayedImage | null | undefined,
): ScreenRect | null {
  if (img) {
    const r = img.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
  }
  if (!container || !d || d.w <= 0 || d.h <= 0) return null
  const cr = container.getBoundingClientRect()
  const lw = container.clientWidth
  const lh = container.clientHeight
  if (lw <= 0 || lh <= 0 || cr.width <= 0 || cr.height <= 0) return null
  const sx = cr.width / lw
  const sy = cr.height / lh
  return {
    left: cr.left + d.ox * sx,
    top: cr.top + d.oy * sy,
    width: d.w * sx,
    height: d.h * sy,
  }
}

export interface SplitDrag {
  axis: SplitAxis
  index: number
  startT: number
  startClient: number
  span: number
}

/** Pixel delta → 0–1 split, using the image's *screen* size so canvas zoom is 1:1. */
export function splitDelta(drag: SplitDrag, clientX: number, clientY: number): number {
  if (!(drag.span > 0)) return drag.startT
  const client = drag.axis === 'v' ? clientX : clientY
  return drag.startT + (client - drag.startClient) / drag.span
}

function sameSplits(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function useCustomSplit(node: LGraphNode, state: StageState) {
  const store = useStageStore()

  const sourceImageUrl = computed<string | null>(() => {
    const inp = state.inputs.find(i => i.slot === 'image')
    return inp && inp.source === 'upstream' && inp.content ? inp.content : null
  })

  const vSplits = ref<number[]>(parseSplits(readWidgetStr(node, 'v_splits', ''), DEFAULT_V_SPLITS))
  const hSplits = ref<number[]>(parseSplits(readWidgetStr(node, 'h_splits', ''), DEFAULT_H_SPLITS))
  const selected = ref<SelectedSplit | null>(null)
  const annotating = ref(false)
  const selectedFace = ref<FaceLabel>(FACE_LABELS[0])

  const cellCount = computed(() => (vSplits.value.length + 1) * (hSplits.value.length + 1))
  const cellLabels = ref<string[]>(parseCellLabels(
    readWidgetStr(node, 'cell_labels', ''), cellCount.value))
  const canAddV = computed(() => vSplits.value.length < MAX_SPLITS)
  const canAddH = computed(() => hSplits.value.length < MAX_SPLITS)

  function syncLabels(count: number) {
    const next = resizeCellLabels(cellLabels.value, count)
    if (next.length === cellLabels.value.length
        && next.every((v, i) => v === cellLabels.value[i])) return
    cellLabels.value = next
  }

  function applyV(next: number[] | null) {
    if (!next) return
    if (sameSplits(next, vSplits.value)) return
    vSplits.value = next
    if (selected.value?.axis === 'v' && selected.value.index >= next.length) {
      selected.value = next.length ? { axis: 'v', index: next.length - 1 } : null
    }
  }

  function applyH(next: number[] | null) {
    if (!next) return
    if (sameSplits(next, hSplits.value)) return
    hSplits.value = next
    if (selected.value?.axis === 'h' && selected.value.index >= next.length) {
      selected.value = next.length ? { axis: 'h', index: next.length - 1 } : null
    }
  }

  function addV() { applyV(insertInLargestGap(vSplits.value)) }
  function addH() { applyH(insertInLargestGap(hSplits.value)) }

  function selectSplit(axis: SplitAxis, index: number) {
    selected.value = { axis, index }
  }

  function setSplit(axis: SplitAxis, index: number, value: number) {
    if (axis === 'v') applyV(setSplitAt(vSplits.value, index, value))
    else applyH(setSplitAt(hSplits.value, index, value))
  }

  function removeSelected() {
    const sel = selected.value
    if (!sel) return
    if (sel.axis === 'v') applyV(removeSplitAt(vSplits.value, sel.index))
    else applyH(removeSplitAt(hSplits.value, sel.index))
    selected.value = null
  }

  function toggleAnnotating() {
    annotating.value = !annotating.value
  }

  function stampCell(index: number) {
    if (!annotating.value) return
    const cur = cellLabels.value[index] || ''
    const name = cur === selectedFace.value ? '' : selectedFace.value
    cellLabels.value = assignFaceLabel(cellLabels.value, index, name)
  }

  function applyAutoFaceLabels(): string[] {
    const next = ensureFaceLabels(cellLabels.value, cellCount.value)
    if (next.length !== cellLabels.value.length
        || next.some((v, i) => v !== cellLabels.value[i])) {
      cellLabels.value = next
    }
    return next
  }

  async function generateMultiViewModel() {
    applyAutoFaceLabels()
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
    await run()
    const { spawnModel3DFromCustomSplit } = await import('@/composables/stages/spawnFollowUp')
    return spawnModel3DFromCustomSplit(node)
  }

  let lineDrag: SplitDrag | null = null

  function beginLineDrag(axis: SplitAxis, index: number, clientX: number, clientY: number, image: ScreenRect) {
    const splits = axis === 'v' ? vSplits.value : hSplits.value
    const startT = splits[index]
    const span = axis === 'v' ? image.width : image.height
    if (startT == null || !(span > 0)) return
    selectSplit(axis, index)
    lineDrag = {
      axis,
      index,
      startT,
      startClient: axis === 'v' ? clientX : clientY,
      span,
    }
  }

  function moveLineDrag(clientX: number, clientY: number) {
    if (!lineDrag) return
    setSplit(lineDrag.axis, lineDrag.index, splitDelta(lineDrag, clientX, clientY))
  }

  function endLineDrag() {
    lineDrag = null
  }

  function readFromWidgets() {
    const v = parseSplits(readWidgetStr(node, 'v_splits', ''), DEFAULT_V_SPLITS)
    const h = parseSplits(readWidgetStr(node, 'h_splits', ''), DEFAULT_H_SPLITS)
    if (!sameSplits(v, vSplits.value)) vSplits.value = v
    if (!sameSplits(h, hSplits.value)) hSplits.value = h
    const labels = parseCellLabels(
      readWidgetStr(node, 'cell_labels', ''),
      (vSplits.value.length + 1) * (hSplits.value.length + 1),
    )
    if (labels.length !== cellLabels.value.length
        || labels.some((x, i) => x !== cellLabels.value[i])) {
      cellLabels.value = labels
    }
  }

  {
    const wv = getWidget(node, 'v_splits')
    if (wv) {
      const orig = wv.callback
      wv.callback = (val: unknown) => {
        orig?.call(wv, val)
        const next = parseSplits(String(val ?? ''), DEFAULT_V_SPLITS)
        if (!sameSplits(next, vSplits.value)) vSplits.value = next
      }
    }
    const wh = getWidget(node, 'h_splits')
    if (wh) {
      const orig = wh.callback
      wh.callback = (val: unknown) => {
        orig?.call(wh, val)
        const next = parseSplits(String(val ?? ''), DEFAULT_H_SPLITS)
        if (!sameSplits(next, hSplits.value)) hSplits.value = next
      }
    }
    const wl = getWidget(node, 'cell_labels')
    if (wl) {
      const orig = wl.callback
      wl.callback = (val: unknown) => {
        orig?.call(wl, val)
        const next = parseCellLabels(
          String(val ?? ''),
          (vSplits.value.length + 1) * (hSplits.value.length + 1),
        )
        if (next.length !== cellLabels.value.length
            || next.some((x, i) => x !== cellLabels.value[i])) {
          cellLabels.value = next
        }
      }
    }
  }

  if (node) {
    const orig = node.onConfigure
    node.onConfigure = function (info: any) {
      orig?.call(this, info)
      readFromWidgets()
    }
  }

  const splitting = ref(false)
  let timer: number | null = null
  let seq = 0
  let cachedImg: HTMLImageElement | null = null
  let cachedUrl: string | null = null

  function getSourceImage(url: string): Promise<HTMLImageElement> {
    if (cachedImg && cachedUrl === url && cachedImg.complete) {
      return Promise.resolve(cachedImg)
    }
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { cachedImg = img; cachedUrl = url; resolve(img) }
      img.onerror = reject
      img.src = url
    })
  }

  function schedule() {
    if (!sourceImageUrl.value) return
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => { timer = null; void run() }, SCHEDULE_DELAY_MS)
  }

  async function run() {
    const url = sourceImageUrl.value
    if (!url) return
    const mySeq = ++seq
    splitting.value = true
    try {
      const img = await getSourceImage(url)
      if (mySeq !== seq) return
      const cells = cellsFromSplits(
        vSplits.value, hSplits.value, img.naturalWidth, img.naturalHeight,
      )
      if (!cells.length) return
      syncLabels(cells.length)

      const prepared = cells.map((cell, i) => ({
        cell,
        label: cellLabels.value[i] || cell.label,
      }))
      const ordered = orderByFaceLabels(prepared, row => row.label)

      const items: { index: string; label: string; image_url: string }[] = []
      const nodeId = String(node?.id ?? 'unknown')
      for (let i = 0; i < ordered.length; i++) {
        const { cell, label } = ordered[i]!
        if (mySeq !== seq) return
        const canvas = document.createElement('canvas')
        canvas.width = cell.w
        canvas.height = cell.h
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h)

        const imageUrl = await uploadCanvas(canvas, {
          subfolder: 'comfytv/customsplit',
          filename: `comfytv-customsplit-${nodeId}-${Date.now()}-${i + 1}.png`,
        })
        if (mySeq !== seq) return
        items.push({
          index: String(i + 1),
          label,
          image_url: imageUrl,
        })
      }
      if (mySeq !== seq) return
      const batch = JSON.stringify({ images: items })
      store.applyExecutedPayload(state, { output: [batch] })
      store.setOutputSlots(state, [
        batch,
        ...items.map(im => im.image_url),
      ])
      syncCustomSplitOutputs(node, items)
    } catch (e) {
      console.error('[ComfyTV/customsplit] split failed', e)
    } finally {
      if (mySeq === seq) splitting.value = false
    }
  }

  watch([vSplits, hSplits], () => {
    writeWidget(node, 'v_splits', serializeSplits(vSplits.value))
    writeWidget(node, 'h_splits', serializeSplits(hSplits.value))
    syncLabels(cellCount.value)
    schedule()
  }, { deep: true })
  watch(cellLabels, () => {
    writeWidget(node, 'cell_labels', serializeCellLabels(cellLabels.value))
    schedule()
  }, { deep: true })
  watch(sourceImageUrl, () => schedule(), { immediate: true })

  return {
    sourceImageUrl,
    vSplits, hSplits,
    selected, selectSplit, setSplit,
    addV, addH, removeSelected,
    beginLineDrag, moveLineDrag, endLineDrag,
    canAddV, canAddH, cellCount,
    splitting,
    FACE_LABELS,
    cellLabels, annotating, selectedFace,
    toggleAnnotating, stampCell,
    applyAutoFaceLabels, generateMultiViewModel,
  }
}
