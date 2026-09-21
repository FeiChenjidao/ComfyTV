import { computed, ref, watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { getWidget, readWidgetNum, readWidgetStr, writeWidget } from '@/utils/widget'
import {
  clamp, eff, handlePts, hitTest, rectPx,
  type DragMode, type Rect,
} from '@/widgets/poster/geometry'
import type { Guide, SnapExtras } from '@/lib/shared2d/snapping'
import { connectedImageCount, curSlot } from '@/widgets/poster/slots'

import {
  fetchPosterElements,
  fetchPosterHtml,
  fetchPosterTemplates,
  type PosterTemplateInfo
} from './posterApi'
import {
  SIZE_PRESETS,
  elementProp,
  layoutColor,
  mergedElements,
  newElementDef,
  nextElementId,
  parseLayout,
  type PosterElement,
  type PosterLayout
} from './posterLayout'
import { usePosterDrag } from './usePosterDrag'

export {
  DEFAULT_COLORS, HANDLE, MIN_WH, SIZE_PRESETS, SNAP_PX,
  applyDrag, cursorFor, elementProp, layoutColor, mergedElements,
  newElementDef, nextElementId, parseLayout,
} from './posterLayout'
export type { PosterElement, PosterLayout } from './posterLayout'

export function usePosterStage(node: LGraphNode, state: () => StageState) {
  const layout = ref<PosterLayout>(parseLayout(readWidgetStr(node, 'layout', '{}')))
  const templateDefs = ref<PosterElement[]>([])
  const templates = ref<PosterTemplateInfo[]>([])
  const editMode = ref(false)
  const snap = ref(true)
  const activeIdx = ref(-1)
  const selectedIds = ref<string[]>([])
  const imgEditId = ref<string | null>(null)
  const snapGuides = ref<Guide[]>([])
  const previewHtml = ref('')
  const previewError = ref('')
  const refreshTick = ref(0)

  const elements = computed(() => mergedElements(templateDefs.value, layout.value))
  const hasElements = computed(() => elements.value.length > 0)
  const activeElement = computed(() =>
    activeIdx.value >= 0 ? elements.value[activeIdx.value] ?? null : null)
  const selectedElements = computed(() =>
    selectedIds.value
      .map(id => elements.value.find(e => e.id === id) ?? null)
      .filter((e): e is PosterElement => e !== null))

  function syncActiveFromSelection() {
    const last = selectedIds.value[selectedIds.value.length - 1]
    activeIdx.value = last == null ? -1 : elements.value.findIndex(e => e.id === last)
  }

  function selectOnly(idx: number) {
    const el = elements.value[idx]
    selectedIds.value = el ? [el.id] : []
    syncActiveFromSelection()
  }

  function toggleSelect(idx: number) {
    const el = elements.value[idx]
    if (!el) return
    const cur = selectedIds.value
    selectedIds.value = cur.includes(el.id)
      ? cur.filter(id => id !== el.id)
      : [...cur, el.id]
    syncActiveFromSelection()
  }

  function clearSelection() {
    selectedIds.value = []
    activeIdx.value = -1
  }

  function selectRegion(region: Rect) {
    const hit = elements.value.filter(el => {
      const r = eff(el, layout.value[el.id])
      return r.x < region.x + region.w && r.x + r.w > region.x
        && r.y < region.y + region.h && r.y + r.h > region.y
    })
    selectedIds.value = hit.map(e => e.id)
    syncActiveFromSelection()
  }

  const template = () => readWidgetStr(node, 'template', templates.value[0]?.name || 'hero')
  const posterWidth = () => Math.max(64, readWidgetNum(node, 'width', 1240) | 0)
  const posterHeight = () => Math.max(64, readWidgetNum(node, 'height', 1754) | 0)

  function upstreamImageUrls(): string[] {
    const rows = state().inputs
      .filter(i => /^images\.image(\d+)$/.test(i.slot) && i.source === 'upstream' && i.content)
      .map(i => ({
        idx: Number(/^images\.image(\d+)$/.exec(i.slot)![1]),
        url: String(i.content),
      }))
      .sort((a, b) => a.idx - b.idx)
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return rows.map(r => {
      try { return new URL(r.url, origin).href } catch { return r.url }
    })
  }

  function graphChanged() {
    ;(node as any).graph?.change?.()
  }

  function commitLayout() {
    writeWidget(node, 'layout', JSON.stringify(layout.value), { fireCallback: false })
    graphChanged()
  }

  function commitAndRefresh() {
    commitLayout()
    scheduleRefresh(0)
  }

  function setRect(id: string, patch: Record<string, unknown>) {
    layout.value[id] = { ...(layout.value[id] || {}), ...patch }
  }

  function effRect(el: PosterElement): Rect {
    return eff(el, layout.value[el.id])
  }

  function setColor(key: string, val: string) {
    layout.value.__colors__ = { ...(layout.value.__colors__ || {}), [key]: val }
    commitAndRefresh()
  }

  function getColor(key: string): string {
    return layoutColor(layout.value, key)
  }

  function elementRot(el: PosterElement): number {
    return Number(elementProp(el, layout.value, 'rot', 0)) || 0
  }

  const guides = computed<Array<{ axis: 'x' | 'y'; pos: number }>>(() => {
    const raw = layout.value.__guides__
    if (!Array.isArray(raw)) return []
    return raw.filter((g: any) =>
      g && (g.axis === 'x' || g.axis === 'y')
      && typeof g.pos === 'number' && g.pos >= 0 && g.pos <= 1)
  })

  function addGuide(axis: 'x' | 'y') {
    layout.value.__guides__ = [...(layout.value.__guides__ || []), { axis, pos: 0.5 }]
    commitLayout()
  }

  function setGuidePos(index: number, pos: number) {
    const list = layout.value.__guides__
    if (!Array.isArray(list) || !list[index]) return
    list[index] = { ...list[index], pos: clamp(pos, 0, 1) }
  }

  function removeGuide(index: number) {
    const list = layout.value.__guides__
    if (!Array.isArray(list)) return
    list.splice(index, 1)
    commitLayout()
  }

  const gridOn = computed(() => !!layout.value.__grid__)

  function toggleGrid() {
    layout.value.__grid__ = !layout.value.__grid__
    commitLayout()
  }

  function snapExtras(): SnapExtras {
    const gs = guides.value
    return {
      guideXs: gs.filter(g => g.axis === 'x').map(g => g.pos),
      guideYs: gs.filter(g => g.axis === 'y').map(g => g.pos),
      gridX: gridOn.value ? 1 / 12 : undefined,
      gridY: gridOn.value ? 1 / 12 : undefined,
    }
  }

  function getFont(key: 'font_title' | 'font_body'): string {
    const f = layout.value.__fonts__ || {}
    return typeof f[key] === 'string' ? f[key] : ''
  }

  function setFont(key: 'font_title' | 'font_body', val: string) {
    layout.value.__fonts__ = { ...(layout.value.__fonts__ || {}), [key]: val }
    commitAndRefresh()
  }

  function collectParams(): Record<string, unknown> {
    return {
      template: template(),
      width: posterWidth(),
      height: posterHeight(),
      layout: JSON.stringify(layout.value),
      images: upstreamImageUrls(),
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight = false
  let pending = false

  async function doRefresh() {
    if (inflight) { pending = true; return }
    inflight = true
    try {
      previewHtml.value = await fetchPosterHtml(collectParams())
      previewError.value = ''
      refreshTick.value++
    } catch (e) {
      previewError.value = String((e as Error)?.message || e)
    } finally {
      inflight = false
      if (pending) { pending = false; scheduleRefresh(40) }
    }
  }

  function scheduleRefresh(delay = 260) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void doRefresh() }, delay)
  }

  async function fetchElements() {
    try {
      templateDefs.value = await fetchPosterElements(collectParams())
    } catch {
      templateDefs.value = []
    }
    clearSelection()
  }

  async function fetchTemplates() {
    try {
      templates.value = await fetchPosterTemplates()
    } catch {
      templates.value = []
    }
  }

  function setTemplate(name: string) {
    writeWidget(node, 'template', name, { fireCallback: false })
    graphChanged()
    void fetchElements()
    scheduleRefresh(0)
  }

  function writePosterSize(w: number, h: number) {
    writeWidget(node, 'width', w, { fireCallback: false })
    writeWidget(node, 'height', h, { fireCallback: false })
    graphChanged()
    scheduleRefresh(0)
  }

  function applySizePreset(label: string) {
    const p = SIZE_PRESETS.find(x => x.label === label)
    if (p) writePosterSize(p.w, p.h)
  }

  function setPosterSize(w: number, h: number) {
    writePosterSize(
      clamp(Math.round(w) || 1240, 256, 4096),
      clamp(Math.round(h) || 1754, 256, 4096),
    )
  }

  function addElement(type: string) {
    const def = newElementDef(type, nextElementId())
    layout.value.__added__ = [...(layout.value.__added__ || []), def]
    commitLayout()
    editMode.value = true
    selectOnly(elements.value.length - 1)
    scheduleRefresh(0)
  }

  function deleteActive() {
    const els = selectedElements.value.length
      ? selectedElements.value
      : (activeElement.value ? [activeElement.value] : [])
    if (!els.length) return
    for (const el of els) {
      if (imgEditId.value === el.id) imgEditId.value = null
      delete layout.value[el.id]
      const added = layout.value.__added__ || []
      const idx = added.findIndex((a: PosterElement) => a.id === el.id)
      if (idx >= 0) {
        added.splice(idx, 1)
      } else {
        layout.value.__removed__ = layout.value.__removed__ || []
        if (!layout.value.__removed__.includes(el.id)) layout.value.__removed__.push(el.id)
      }
    }
    clearSelection()
    commitAndRefresh()
  }

  const dragApi = usePosterDrag({
    layout, elements, selectedIds, selectedElements, activeIdx, imgEditId,
    snap, snapGuides, selectOnly, effRect, setRect, elementRot, snapExtras,
    commitLayout, scheduleRefresh,
  })

  function setElementProp(key: string, val: unknown) {
    const el = activeElement.value
    if (!el) return
    const patch: Record<string, unknown> = { [key]: val }
    if (key === 'font_size' || key === 'align') patch.fit = false
    if (key === 'align') patch.columns = 1
    setRect(el.id, patch)
    commitAndRefresh()
  }

  function connectedImages(): number {
    return connectedImageCount(((node as any).inputs || []))
  }

  function slotOf(el: PosterElement): number {
    return curSlot(el, layout.value[el.id])
  }

  function setSlot(el: PosterElement, slot: number) {
    setRect(el.id, { slot })
    commitAndRefresh()
  }

  function gridLabels(): string {
    const v = layout.value.__grid_labels__
    return typeof v === 'string' ? v : ''
  }

  function setGridLabelLine(index: number, text: string) {
    const lines = gridLabels().replace(/\r\n/g, '\n').split('\n')
    while (lines.length <= index) lines.push('')
    lines[index] = text.replace(/\n/g, ' ')
    layout.value.__grid_labels__ = lines.join('\n')
    commitLayout()
    void fetchElements()
    scheduleRefresh(0)
  }

  function reloadFromWidget() {
    layout.value = parseLayout(readWidgetStr(node, 'layout', '{}'))
  }

  watch(() => state().inputs.map(i => `${i.slot}:${i.content ?? ''}`).join('|'), () => {
    scheduleRefresh(120)
  })

  return {
    layout, templateDefs, templates, editMode, snap, activeIdx, imgEditId,
    snapGuides, previewHtml, previewError, refreshTick,
    elements, hasElements, activeElement,
    selectedIds, selectedElements, selectOnly, toggleSelect, clearSelection,
    selectRegion, elementRot,
    guides, addGuide, setGuidePos, removeGuide, gridOn, toggleGrid,
    template, posterWidth, posterHeight, upstreamImageUrls,
    commitLayout, setRect, effRect, getColor, setColor, getFont, setFont,
    collectParams, doRefresh, scheduleRefresh, fetchElements, fetchTemplates,
    setTemplate, applySizePreset, setPosterSize,
    addElement, deleteActive,
    ...dragApi,
    setElementProp, connectedImages, slotOf, setSlot,
    gridLabels, setGridLabelLine, reloadFromWidget,
  }
}

export { eff, rectPx, handlePts, hitTest, clamp }
export type { Rect, DragMode, Guide }
export { getWidget }
