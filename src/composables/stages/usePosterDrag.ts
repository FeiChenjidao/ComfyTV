import { reactive, type ComputedRef, type Ref } from 'vue'

import { arrange, unionRect, type ArrangeOp } from '@/lib/shared2d/arrange'
import { applySnap, buildSnapTargets, type Guide, type SnapExtras } from '@/lib/shared2d/snapping'
import { clamp, type DragMode, type Rect } from '@/widgets/poster/geometry'

import {
  MIN_WH,
  applyDrag,
  elementImageProps,
  type PosterElement,
  type PosterLayout
} from './posterLayout'

export interface PosterDragCore {
  layout: Ref<PosterLayout>
  elements: ComputedRef<PosterElement[]>
  selectedIds: Ref<string[]>
  selectedElements: ComputedRef<PosterElement[]>
  activeIdx: Ref<number>
  imgEditId: Ref<string | null>
  snap: Ref<boolean>
  snapGuides: Ref<Guide[]>
  selectOnly(idx: number): void
  effRect(el: PosterElement): Rect
  setRect(id: string, patch: Record<string, unknown>): void
  elementRot(el: PosterElement): number
  snapExtras(): SnapExtras
  commitLayout(): void
  scheduleRefresh(delay?: number): void
}

export function usePosterDrag(core: PosterDragCore) {
  const drag = reactive<{
    mode: DragMode | null
    id: string
    startN: { x: number; y: number }
    startRect: Rect
    groupBases: Array<{ id: string; rect: Rect }> | null
    targets: ReturnType<typeof buildSnapTargets> | null
    eqRects: Rect[] | null
    rotated: boolean
    moved: boolean
  }>({ mode: null, id: '', startN: { x: 0, y: 0 }, startRect: { x: 0, y: 0, w: 0, h: 0 }, groupBases: null, targets: null, eqRects: null, rotated: false, moved: false })

  const imgDrag = reactive<{
    id: string | null
    boxW: number
    boxH: number
    startPx: { x: number; y: number }
    start: { scale: number; x: number; y: number }
  }>({ id: null, boxW: 1, boxH: 1, startPx: { x: 0, y: 0 }, start: { scale: 1, x: 0, y: 0 } })

  function commitAndRefresh() {
    core.commitLayout()
    core.scheduleRefresh(0)
  }

  function startDrag(hit: { idx: number; mode: DragMode }, nx: number, ny: number) {
    const el = core.elements.value[hit.idx]
    if (!el) return
    const group = hit.mode === 'move'
      && core.selectedIds.value.length > 1
      && core.selectedIds.value.includes(el.id)
    if (!group) core.selectOnly(hit.idx)
    else core.activeIdx.value = hit.idx
    if (core.imgEditId.value !== el.id) core.imgEditId.value = null
    drag.mode = hit.mode
    drag.id = el.id
    drag.startN = { x: nx, y: ny }
    if (group) {
      drag.groupBases = core.selectedElements.value.map(e => ({ id: e.id, rect: core.effRect(e) }))
      drag.startRect = unionRect(drag.groupBases.map(b => b.rect))
    } else {
      drag.groupBases = null
      drag.startRect = core.effRect(el)
    }
    const excluded = new Set(group ? core.selectedIds.value : [el.id])
    const otherRects = core.elements.value.filter(e => !excluded.has(e.id)).map(e => core.effRect(e))
    drag.targets = buildSnapTargets(otherRects, undefined, core.snapExtras())
    drag.eqRects = otherRects
    drag.rotated = !group && core.elementRot(el) !== 0
    drag.moved = false
  }

  function moveDrag(
    nx: number, ny: number, altKey: boolean, thrX: number, thrY: number,
  ): Array<{ id: string; rect: Rect }> {
    if (!drag.mode) return []
    let rect = applyDrag(drag.mode, drag.startRect, nx - drag.startN.x, ny - drag.startN.y)
    let dragGuides: Guide[] = []
    if (core.snap.value && !altKey && !drag.rotated && drag.targets) {
      const res = applySnap(drag.mode, rect, drag.targets, {
        thrX, thrY, minWH: MIN_WH,
        eqRects: drag.mode === 'move' ? drag.eqRects ?? undefined : undefined,
      })
      rect = res.rect
      dragGuides = res.guides
    }
    core.snapGuides.value = dragGuides
    if (rect.x !== drag.startRect.x || rect.y !== drag.startRect.y
        || rect.w !== drag.startRect.w || rect.h !== drag.startRect.h) {
      drag.moved = true
    }
    if (drag.groupBases) {
      const dx = rect.x - drag.startRect.x
      const dy = rect.y - drag.startRect.y
      const out = drag.groupBases.map(b => ({
        id: b.id,
        rect: { x: b.rect.x + dx, y: b.rect.y + dy, w: b.rect.w, h: b.rect.h },
      }))
      for (const o of out) core.setRect(o.id, { ...o.rect })
      return out
    }
    core.setRect(drag.id, { ...rect })
    return [{ id: drag.id, rect }]
  }

  function endDrag(): boolean {
    const moved = drag.moved
    drag.mode = null
    drag.targets = null
    drag.eqRects = null
    drag.groupBases = null
    core.snapGuides.value = []
    if (moved) commitAndRefresh()
    return moved
  }

  function applyArrange(op: ArrangeOp) {
    const els = core.selectedElements.value
    if (els.length < 2) return
    const rects = els.map(e => core.effRect(e))
    const deltas = arrange(rects, op)
    let changed = false
    for (let i = 0; i < els.length; i++) {
      const d = deltas[i]!
      if (d.dx === 0 && d.dy === 0) continue
      const r = rects[i]!
      core.setRect(els[i]!.id, {
        x: clamp(r.x + d.dx, 0, 1 - r.w),
        y: clamp(r.y + d.dy, 0, 1 - r.h),
      })
      changed = true
    }
    if (changed) commitAndRefresh()
  }

  function imageProps(el: PosterElement) {
    return elementImageProps(el, core.layout.value)
  }

  function startImgDrag(el: PosterElement, boxW: number, boxH: number, px: number, py: number) {
    imgDrag.id = el.id
    imgDrag.boxW = boxW
    imgDrag.boxH = boxH
    imgDrag.startPx = { x: px, y: py }
    imgDrag.start = imageProps(el)
  }

  function moveImgDrag(px: number, py: number) {
    if (!imgDrag.id) return
    const dx = (px - imgDrag.startPx.x) / imgDrag.boxW
    const dy = (py - imgDrag.startPx.y) / imgDrag.boxH
    const max = Math.max(0, (imgDrag.start.scale - 1) / 2)
    core.setRect(imgDrag.id, {
      img_x: clamp(imgDrag.start.x + dx, -max, max),
      img_y: clamp(imgDrag.start.y + dy, -max, max),
    })
  }

  function endImgDrag() {
    if (!imgDrag.id) return
    imgDrag.id = null
    commitAndRefresh()
  }

  function setImgScale(el: PosterElement, scale: number) {
    const s = clamp(scale || 1, 1, 4)
    const max = Math.max(0, (s - 1) / 2)
    const p = imageProps(el)
    core.setRect(el.id, {
      img_scale: s,
      img_x: clamp(p.x, -max, max),
      img_y: clamp(p.y, -max, max),
    })
  }

  return {
    drag,
    imgDrag,
    startDrag,
    moveDrag,
    endDrag,
    applyArrange,
    elementImageProps: imageProps,
    startImgDrag,
    moveImgDrag,
    endImgDrag,
    setImgScale
  }
}
