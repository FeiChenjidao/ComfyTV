import { clamp, type DragMode, type Rect } from '@/widgets/poster/geometry'

export interface PosterElement {
  id: string
  type: string
  label?: string
  bind?: string
  slot?: number
  text?: string
  data?: string
  shape?: string
  fill?: string
  stroke?: string
  font?: string
  font_size?: number
  align?: string
  color?: string
  x?: number; y?: number; w?: number; h?: number
  [key: string]: unknown
}

export type PosterLayout = Record<string, any>

export const DEFAULT_COLORS: Record<string, string> = {
  primary_color: '#1f1b16',
  accent_color: '#9c2b2b',
  bg_color: '#f4ece0',
}

export const SIZE_PRESETS = [
  { label: 'A4 竖 1240×1754', w: 1240, h: 1754 },
  { label: 'A3 竖 1754×2480', w: 1754, h: 2480 },
  { label: '方形 1240×1240', w: 1240, h: 1240 },
  { label: '竖屏 9:16 1080×1920', w: 1080, h: 1920 },
  { label: '宽屏 16:9 1920×1080', w: 1920, h: 1080 },
  { label: '海报 2:3 1240×1860', w: 1240, h: 1860 },
]

export const HANDLE = 7
export const MIN_WH = 0.02
export const SNAP_PX = 6

export function parseLayout(raw: string): PosterLayout {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function mergedElements(
  templateDefs: PosterElement[], layout: PosterLayout,
): PosterElement[] {
  const added = Array.isArray(layout.__added__) ? layout.__added__ : []
  const removed = Array.isArray(layout.__removed__) ? layout.__removed__ : []
  const tdefs = templateDefs.filter(d => !removed.includes(d.id))
  return [...tdefs, ...added]
}

export function layoutColor(layout: PosterLayout, key: string): string {
  const c = layout.__colors__ || {}
  const v = c[key]
  return (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ? v : DEFAULT_COLORS[key]!
}

export function elementProp<T>(
  el: PosterElement, layout: PosterLayout, key: string, dflt: T,
): T {
  const ov = layout[el.id] || {}
  if (ov[key] != null) return ov[key] as T
  if ((el as any)[key] != null) return (el as any)[key] as T
  return dflt
}

export function newElementDef(type: string, id: string): PosterElement {
  const base = { id, x: 0.32, y: 0.32, w: 0.36, h: 0.18 }
  if (type === 'image') return { ...base, type: 'image', slot: 0 }
  if (type === 'shape') {
    return { ...base, type: 'shape', shape: 'rect', h: 0.1, stroke: 'accent', stroke_width: 3 }
  }
  return { ...base, type: 'text', text: '新文本', font: 'body', font_size: 36, align: 'left' }
}

export function applyDrag(
  mode: DragMode, start: Rect, dx: number, dy: number,
): Rect {
  let { x, y, w, h } = start
  if (mode === 'move') {
    x = clamp(x + dx, 0, 1 - w)
    y = clamp(y + dy, 0, 1 - h)
  } else {
    if (mode.includes('e')) w = clamp(w + dx, MIN_WH, 1 - x)
    if (mode.includes('s')) h = clamp(h + dy, MIN_WH, 1 - y)
    if (mode.includes('w')) { const nw = clamp(w - dx, MIN_WH, x + w); x = x + w - nw; w = nw }
    if (mode.includes('n')) { const nh = clamp(h - dy, MIN_WH, y + h); y = y + h - nh; h = nh }
  }
  return { x, y, w, h }
}

export function cursorFor(hit: { mode: DragMode } | null): string {
  if (!hit) return 'default'
  if (hit.mode === 'move') return 'move'
  const map: Record<string, string> = {
    n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse',
  }
  return `${map[hit.mode]}-resize`
}

let _uidCounter = 0
export function nextElementId(): string {
  _uidCounter += 1
  return `u${Date.now().toString(36)}${_uidCounter.toString(36)}`
}

export function elementImageProps(el: PosterElement, layout: PosterLayout) {
  return {
    scale: Number(elementProp(el, layout, 'img_scale', 1)) || 1,
    x: Number(elementProp(el, layout, 'img_x', 0)) || 0,
    y: Number(elementProp(el, layout, 'img_y', 0)) || 0,
  }
}
