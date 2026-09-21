import { ref, type Ref } from 'vue'

import {
  HANDLE,
  SNAP_PX,
  cursorFor,
  hitTest,
  rectPx,
  type Rect
} from '@/composables/stages/usePosterStage'
import { angleTo, handlePos } from '@/lib/shared2d/transformMath'

import { livePatchImg, livePatchRect, livePatchRotate } from './posterLivePatch'
import { elTransformPx, type Marquee, type PosterStage } from './posterOverlay'
import type { usePosterInlineEdit } from './usePosterInlineEdit'

interface Deps {
  ps: PosterStage
  overlay: Ref<HTMLCanvasElement | null>
  stageWrap: Ref<HTMLElement | null>
  frontFrame: () => HTMLIFrameElement | null
  drawOverlay: () => void
  edit: ReturnType<typeof usePosterInlineEdit>
}

export function usePosterPointer({ ps, overlay, stageWrap, frontFrame, drawOverlay, edit }: Deps) {
  const marquee = ref<Marquee | null>(null)
  const rotDrag = ref<{ id: string; baseDeg: number; grab: number } | null>(null)
  const guideDrag = ref<{ index: number } | null>(null)

  function evXY(e: PointerEvent | MouseEvent): [number, number] {
    const cv = overlay.value!
    const r = cv.getBoundingClientRect()
    const sx = r.width ? cv.width / r.width : 1
    const sy = r.height ? cv.height / r.height : 1
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy]
  }

  function rectsPx(): Rect[] {
    const cv = overlay.value!
    return ps.elements.value.map(el => rectPx(ps.effRect(el), cv.width, cv.height))
  }

  function guideHitIndex(px: number, py: number): number {
    const cv = overlay.value!
    const gs = ps.guides.value
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i]!
      const d = g.axis === 'x' ? Math.abs(px - g.pos * cv.width) : Math.abs(py - g.pos * cv.height)
      if (d <= 4) return i
    }
    return -1
  }

  function singleActiveIdx(): number {
    return ps.selectedIds.value.length === 1 ? ps.activeIdx.value : -1
  }

  function imgEditHit(px: number, py: number): Rect | null {
    const cv = overlay.value!
    const el = ps.imgEditId.value
      ? ps.elements.value.find(x => x.id === ps.imgEditId.value)
      : null
    if (!el) return null
    const r = rectPx(ps.effRect(el), cv.width, cv.height)
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h ? r : null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    edit.closeInline(true)
    edit.picker.value = null
    const cv = overlay.value!
    const [px, py] = evXY(e)
    const editRect = imgEditHit(px, py)
    if (editRect) {
      const editEl = ps.elements.value.find(el => el.id === ps.imgEditId.value)!
      e.preventDefault()
      cv.setPointerCapture(e.pointerId)
      ps.selectOnly(ps.elements.value.indexOf(editEl))
      ps.startImgDrag(editEl, editRect.w, editRect.h, px, py)
      cv.style.cursor = 'grabbing'
      drawOverlay()
      return
    }
    if (ps.selectedIds.value.length === 1 && ps.activeElement.value) {
      const t = elTransformPx(ps, cv, ps.activeElement.value)
      const rp = handlePos(t, 'rotate')
      if (Math.hypot(px - rp.x, py - rp.y) <= HANDLE + 2) {
        e.preventDefault()
        cv.setPointerCapture(e.pointerId)
        rotDrag.value = {
          id: ps.activeElement.value.id,
          baseDeg: ps.elementRot(ps.activeElement.value),
          grab: angleTo(t, { x: px, y: py }),
        }
        return
      }
    }
    const hit = hitTest(px, py, rectsPx(), singleActiveIdx(), HANDLE)
    if (!hit) {
      ps.imgEditId.value = null
      const gi = guideHitIndex(px, py)
      if (gi >= 0 && !e.shiftKey) {
        e.preventDefault()
        cv.setPointerCapture(e.pointerId)
        guideDrag.value = { index: gi }
        return
      }
      if (!e.shiftKey) {
        ps.clearSelection()
        e.preventDefault()
        cv.setPointerCapture(e.pointerId)
        marquee.value = { x0: px, y0: py, x1: px, y1: py }
      }
      drawOverlay()
      return
    }
    if (e.shiftKey) {
      e.preventDefault()
      ps.toggleSelect(hit.idx)
      drawOverlay()
      return
    }
    e.preventDefault()
    cv.setPointerCapture(e.pointerId)
    try { stageWrap.value?.focus({ preventScroll: true }) } catch {}
    ps.startDrag(hit, px / cv.width, py / cv.height)
    drawOverlay()
  }

  function onPointerMove(e: PointerEvent) {
    const cv = overlay.value!
    const [px, py] = evXY(e)
    if (rotDrag.value) {
      const d = rotDrag.value
      const el = ps.elements.value.find(x => x.id === d.id)
      if (!el) return
      const t = elTransformPx(ps, cv, el)
      let deg = d.baseDeg + (angleTo(t, { x: px, y: py }) - d.grab) * 180 / Math.PI
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      deg = ((deg % 360) + 360) % 360
      if (deg > 180) deg -= 360
      ps.setRect(d.id, { rot: Math.round(deg * 10) / 10 })
      livePatchRotate(frontFrame(), d.id, ps.elementRot(el))
      drawOverlay()
      return
    }
    if (guideDrag.value) {
      const g = ps.guides.value[guideDrag.value.index]
      if (g) {
        ps.setGuidePos(guideDrag.value.index,
          g.axis === 'x' ? px / cv.width : py / cv.height)
        drawOverlay()
      }
      return
    }
    if (marquee.value) {
      marquee.value = { ...marquee.value, x1: px, y1: py }
      drawOverlay()
      return
    }
    if (ps.imgDrag.id) {
      ps.moveImgDrag(px, py)
      const el = ps.elements.value.find(x => x.id === ps.imgDrag.id)
      if (el) livePatchImg(frontFrame(), el.id, ps.elementImageProps(el))
      return
    }
    if (!ps.drag.mode) {
      if (imgEditHit(px, py)) {
        cv.style.cursor = 'grab'
        return
      }
      cv.style.cursor = cursorFor(hitTest(px, py, rectsPx(), singleActiveIdx(), HANDLE))
      return
    }
    const rects = ps.moveDrag(
      px / cv.width, py / cv.height, e.altKey,
      SNAP_PX / cv.width, SNAP_PX / cv.height,
    )
    for (const r of rects) livePatchRect(frontFrame(), r.id, r.rect, ps.drag.mode !== 'move')
    drawOverlay()
  }

  function onPointerUp(e: PointerEvent) {
    const cv = overlay.value
    try { cv?.releasePointerCapture(e.pointerId) } catch {}
    if (rotDrag.value) {
      rotDrag.value = null
      ps.commitLayout()
      ps.scheduleRefresh(0)
      drawOverlay()
      return
    }
    if (guideDrag.value) {
      const idx = guideDrag.value.index
      guideDrag.value = null
      const [px, py] = cv ? evXY(e) : [0, 0]
      if (cv && (px < -8 || py < -8 || px > cv.width + 8 || py > cv.height + 8)) {
        ps.removeGuide(idx)
      } else {
        ps.commitLayout()
      }
      drawOverlay()
      return
    }
    if (marquee.value) {
      const m = marquee.value
      marquee.value = null
      if (cv && (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4)) {
        ps.selectRegion({
          x: Math.min(m.x0, m.x1) / cv.width,
          y: Math.min(m.y0, m.y1) / cv.height,
          w: Math.abs(m.x1 - m.x0) / cv.width,
          h: Math.abs(m.y1 - m.y0) / cv.height,
        })
      }
      drawOverlay()
      return
    }
    if (ps.imgDrag.id) {
      ps.endImgDrag()
      if (cv) cv.style.cursor = 'grab'
      return
    }
    if (ps.drag.mode) {
      ps.endDrag()
      drawOverlay()
    }
  }

  function onDblClick(e: MouseEvent) {
    const cv = overlay.value!
    const [px, py] = evXY(e)
    const hit = hitTest(px, py, rectsPx(), ps.activeIdx.value, HANDLE)
    if (!hit) return
    const el = ps.elements.value[hit.idx]
    if (!el) return
    ps.selectOnly(hit.idx)
    if (el.type === 'text') {
      edit.openInline(el, 'literal', 0)
    } else if (el.type === 'bars' || el.type === 'tree') {
      edit.openInline(el, 'data', 0)
    } else if (el.type === 'cell') {
      const r = rectPx(ps.effRect(el), cv.width, cv.height)
      const capZone = Math.max(18, r.h * 0.22)
      if (py >= r.y + r.h - capZone) {
        const m = /cell(\d+)/.exec(el.id)
        edit.openInline(el, 'label', m ? parseInt(m[1]!, 10) : 0)
      } else {
        edit.openSlotPicker(el, px, py)
      }
    } else if (el.type === 'image') {
      edit.openSlotPicker(el, px, py)
    } else if (el.type === 'shape') {
      edit.openShapePicker(el, px, py)
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (edit.inline.value || !ps.selectedIds.value.length) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      ps.deleteActive()
      drawOverlay()
    }
  }

  return { marquee, onPointerDown, onPointerMove, onPointerUp, onDblClick, onKeydown }
}
