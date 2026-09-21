import { computed, nextTick, ref, type Ref } from 'vue'

import {
  elementProp,
  rectPx,
  type PosterElement,
  type Rect
} from '@/composables/stages/usePosterStage'

import type { PosterStage } from './posterOverlay'

export type InlineKind = 'literal' | 'data' | 'label'

export interface PosterView {
  scale: number
  offX: number
  offY: number
  cw: number
  ch: number
}

export interface PickerOption {
  key: string
  label: string
  active: boolean
  onPick: () => void
}

interface Deps {
  ps: PosterStage
  overlay: Ref<HTMLCanvasElement | null>
  view: Ref<PosterView>
  t: (key: string, values?: Record<string, unknown>) => string
  drawOverlay: () => void
}

export function usePosterInlineEdit({ ps, overlay, view, t, drawOverlay }: Deps) {
  const inlineTa = ref<HTMLTextAreaElement | null>(null)
  const inline = ref<{
    el: PosterElement
    kind: InlineKind
    refIndex: number
    text: string
    rect: Rect
  } | null>(null)
  const picker = ref<{
    title: string
    x: number
    y: number
    options: PickerOption[]
  } | null>(null)

  const inlineStyle = computed(() => {
    const box = inline.value
    if (!box) return {}
    const h = box.kind === 'label' ? 26 : Math.max(48, box.rect.h)
    return {
      left: `${box.rect.x + view.value.offX}px`,
      top: `${box.kind === 'label' ? box.rect.y + box.rect.h - h + view.value.offY : box.rect.y + view.value.offY}px`,
      width: `${Math.max(60, box.rect.w)}px`,
      height: `${h}px`,
    }
  })

  function openInline(el: PosterElement, kind: InlineKind, refIndex: number) {
    const cv = overlay.value!
    const r = rectPx(ps.effRect(el), cv.width, cv.height)
    let initial = ''
    if (kind === 'literal') {
      initial = String(elementProp(el, ps.layout.value, 'text', el.text ?? ''))
    } else if (kind === 'data') {
      initial = String(elementProp(el, ps.layout.value, 'data', el.data ?? ''))
    } else {
      const lines = ps.gridLabels().replace(/\r\n/g, '\n').split('\n')
      initial = lines[refIndex] ?? (el.label || '')
    }
    inline.value = { el, kind, refIndex, text: initial, rect: r }
    void nextTick(() => {
      inlineTa.value?.focus()
      inlineTa.value?.select()
    })
  }

  function closeInline(commit: boolean) {
    const box = inline.value
    if (!box) return
    inline.value = null
    if (!commit) return
    if (box.kind === 'literal') {
      ps.setRect(box.el.id, { text: box.text })
      ps.commitLayout()
      ps.scheduleRefresh(0)
    } else if (box.kind === 'data') {
      ps.setRect(box.el.id, { data: box.text })
      ps.commitLayout()
      ps.scheduleRefresh(0)
    } else {
      ps.setGridLabelLine(box.refIndex, box.text)
    }
  }

  function onInlineKeydown(e: KeyboardEvent) {
    e.stopPropagation()
    const multi = inline.value?.kind !== 'label'
    if (e.key === 'Escape') {
      e.preventDefault()
      closeInline(false)
    } else if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      closeInline(true)
    }
  }

  function pickerPos(px: number, py: number, minW: number) {
    return {
      x: Math.min(px + view.value.offX, Math.max(0, view.value.cw - minW)),
      y: Math.min(py + view.value.offY, Math.max(0, view.value.ch - 40)),
    }
  }

  function openSlotPicker(el: PosterElement, px: number, py: number) {
    const cur = ps.slotOf(el)
    const cellCount = ps.elements.value.filter(e => e.type === 'cell' || e.type === 'image').length
    const k = Math.min(99, Math.max(ps.connectedImages(), cellCount, cur + 1, 1))
    const options: PickerOption[] = []
    for (let i = 0; i < k; i++) {
      options.push({
        key: `s${i}`,
        label: t('poster.slotN', { n: i }) + (i === cur ? ' ✓' : ''),
        active: i === cur,
        onPick: () => { ps.setSlot(el, i); drawOverlay() },
      })
    }
    picker.value = {
      title: t('poster.slotTitle', { label: el.label || el.id }),
      ...pickerPos(px, py, 130),
      options,
    }
  }

  function openShapePicker(el: PosterElement, px: number, py: number) {
    const cur = {
      shape: String(elementProp(el, ps.layout.value, 'shape', 'rect')),
      fill: String(elementProp(el, ps.layout.value, 'fill', 'none')),
      stroke: String(elementProp(el, ps.layout.value, 'stroke', 'primary')),
    }
    const mk = (key: string, label: string, active: boolean, patch: Record<string, unknown>) => ({
      key, label: label + (active ? ' ✓' : ''), active,
      onPick: () => {
        ps.setRect(el.id, patch)
        ps.commitLayout()
        ps.scheduleRefresh(0)
        drawOverlay()
      },
    })
    picker.value = {
      title: t('poster.shapeTitle'),
      ...pickerPos(px, py, 140),
      options: [
        mk('rect', t('poster.shapeRect'), cur.shape === 'rect', { shape: 'rect' }),
        mk('ellipse', t('poster.shapeEllipse'), cur.shape === 'ellipse', { shape: 'ellipse' }),
        mk('line', t('poster.shapeLine'), cur.shape === 'line', { shape: 'line' }),
        mk('f-accent', t('poster.fillAccent'), cur.fill === 'accent', { fill: 'accent' }),
        mk('f-primary', t('poster.fillPrimary'), cur.fill === 'primary', { fill: 'primary' }),
        mk('f-bg', t('poster.fillBg'), cur.fill === 'bg', { fill: 'bg' }),
        mk('f-none', t('poster.fillNone'), cur.fill === 'none', { fill: 'none' }),
        mk('s-accent', t('poster.strokeAccent'), cur.stroke === 'accent', { stroke: 'accent' }),
        mk('s-primary', t('poster.strokePrimary'), cur.stroke === 'primary', { stroke: 'primary' }),
        mk('s-none', t('poster.strokeNone'), cur.stroke === 'none', { stroke: 'none' }),
      ],
    }
  }

  return {
    inline,
    inlineTa,
    picker,
    inlineStyle,
    openInline,
    closeInline,
    onInlineKeydown,
    openSlotPicker,
    openShapePicker
  }
}
