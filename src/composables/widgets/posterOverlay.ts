import {
  HANDLE,
  rectPx,
  type PosterElement,
  type Rect,
  type usePosterStage
} from '@/composables/stages/usePosterStage'
import { handlePos, type Transform } from '@/lib/shared2d/transformMath'

export type PosterStage = ReturnType<typeof usePosterStage>

export interface Marquee {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function elTransformPx(
  ps: PosterStage,
  cv: HTMLCanvasElement,
  el: PosterElement
): Transform {
  const r = ps.effRect(el)
  return {
    x: r.x * cv.width, y: r.y * cv.height,
    w: r.w * cv.width, h: r.h * cv.height,
    rotation: ps.elementRot(el) * Math.PI / 180,
  }
}

export function rotatedCorners(t: Transform): [number, number][] {
  return (['nw', 'ne', 'se', 'sw'] as const).map(h => {
    const p = handlePos(t, h)
    return [p.x, p.y]
  })
}

export function handlePtsPx(r: Rect): [number, number][] {
  const mx = r.x + r.w / 2
  const my = r.y + r.h / 2
  return [
    [r.x, r.y], [mx, r.y], [r.x + r.w, r.y],
    [r.x, my], [r.x + r.w, my],
    [r.x, r.y + r.h], [mx, r.y + r.h], [r.x + r.w, r.y + r.h],
  ]
}

function strokeAxisLine(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  axis: 'x' | 'y',
  pos: number
): void {
  ctx.beginPath()
  if (axis === 'x') {
    const X = Math.round(pos * cv.width) + 0.5
    ctx.moveTo(X, 0); ctx.lineTo(X, cv.height)
  } else {
    const Y = Math.round(pos * cv.height) + 0.5
    ctx.moveTo(0, Y); ctx.lineTo(cv.width, Y)
  }
  ctx.stroke()
}

function drawElements(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  ps: PosterStage,
  imgDragHint: string
): void {
  const selected = new Set(ps.selectedIds.value)
  const single = selected.size === 1
  ps.elements.value.forEach((el) => {
    const r = rectPx(ps.effRect(el), cv.width, cv.height)
    const active = selected.has(el.id)
    const imgEdit = ps.imgEditId.value === el.id
    const rot = ps.elementRot(el)
    ctx.lineWidth = active ? 2 : 1
    ctx.strokeStyle = imgEdit ? '#3fd6a0' : (active ? '#46b4e6' : 'rgba(70,180,230,0.5)')
    ctx.fillStyle = imgEdit ? 'rgba(63,214,160,0.08)'
      : (active ? 'rgba(70,180,230,0.10)' : 'rgba(70,180,230,0.04)')
    if (rot) {
      const corners = rotatedCorners(elTransformPx(ps, cv, el))
      ctx.beginPath()
      ctx.moveTo(corners[0]![0], corners[0]![1])
      for (const [cx2, cy2] of corners.slice(1)) ctx.lineTo(cx2, cy2)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    ctx.fillStyle = imgEdit ? '#3fd6a0' : (active ? '#46b4e6' : 'rgba(200,220,235,0.8)')
    ctx.font = '11px monospace'
    ctx.fillText(imgEdit ? imgDragHint : (el.label || el.id), r.x + 4, r.y + 13)
    if (active && single && !imgEdit) {
      ctx.fillStyle = '#46b4e6'
      if (!rot) {
        for (const [hx, hy] of handlePtsPx(r)) {
          ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
        }
      }
      const tpx = elTransformPx(ps, cv, el)
      const n = handlePos(tpx, 'n')
      const rp = handlePos(tpx, 'rotate')
      ctx.strokeStyle = '#46b4e6'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(rp.x, rp.y); ctx.stroke()
      ctx.beginPath(); ctx.arc(rp.x, rp.y, HANDLE / 2 + 1, 0, Math.PI * 2)
      ctx.fill()
    }
  })
}

function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  ps: PosterStage
): void {
  for (const g of ps.snapGuides.value) {
    ctx.strokeStyle = '#ff3b6b'
    ctx.lineWidth = 1
    if (g.kind === 'gap' && g.spans && g.cross != null) {
      const crossPx = g.axis === 'x' ? g.cross * cv.height : g.cross * cv.width
      for (const [a, b] of g.spans) {
        const a0 = g.axis === 'x' ? a * cv.width : a * cv.height
        const b0 = g.axis === 'x' ? b * cv.width : b * cv.height
        ctx.beginPath()
        if (g.axis === 'x') {
          ctx.moveTo(a0, crossPx); ctx.lineTo(b0, crossPx)
          ctx.moveTo(a0, crossPx - 4); ctx.lineTo(a0, crossPx + 4)
          ctx.moveTo(b0, crossPx - 4); ctx.lineTo(b0, crossPx + 4)
        } else {
          ctx.moveTo(crossPx, a0); ctx.lineTo(crossPx, b0)
          ctx.moveTo(crossPx - 4, a0); ctx.lineTo(crossPx + 4, a0)
          ctx.moveTo(crossPx - 4, b0); ctx.lineTo(crossPx + 4, b0)
        }
        ctx.stroke()
      }
      continue
    }
    strokeAxisLine(ctx, cv, g.axis, g.pos)
  }
}

export function drawPosterOverlay(
  cv: HTMLCanvasElement,
  ps: PosterStage,
  marquee: Marquee | null,
  imgDragHint: string
): void {
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, cv.width, cv.height)
  if (!(ps.editMode.value && ps.hasElements.value)) return
  if (ps.gridOn.value) {
    ctx.strokeStyle = 'rgba(120,140,160,0.18)'
    ctx.lineWidth = 1
    for (let i = 1; i < 12; i++) {
      const X = Math.round(cv.width * i / 12) + 0.5
      const Y = Math.round(cv.height * i / 12) + 0.5
      ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, cv.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(cv.width, Y); ctx.stroke()
    }
  }
  drawElements(ctx, cv, ps, imgDragHint)
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = '#22d3ee'
  ctx.lineWidth = 1
  ps.guides.value.forEach((g) => strokeAxisLine(ctx, cv, g.axis, g.pos))
  ctx.setLineDash([])
  drawSnapGuides(ctx, cv, ps)
  if (marquee) {
    const m = marquee
    ctx.strokeStyle = '#46b4e6'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.strokeRect(
      Math.min(m.x0, m.x1) + 0.5, Math.min(m.y0, m.y1) + 0.5,
      Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0),
    )
    ctx.setLineDash([])
  }
}
