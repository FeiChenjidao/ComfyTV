/** Hide V2 control panels unless the card is selected (plugin setting). */

import { useResizeObserver } from '@vueuse/core'
import { onScopeDispose, type EffectScope } from 'vue'

import { app, type ComfyNode } from '@/lib/comfyApp'

export const PANEL_ON_SELECT_ATTR = 'data-v2-panel-on-select'
export const PANEL_ON_SELECT_SETTING = 'v2-panel-on-select'
export const PANEL_ON_SELECT_CHANGE = 'comfytv:v2-panel-on-select-change'

/** Selectors that CSS hides when panel-on-select is on and the card is not selected. */
export const PANEL_HIDE_SEL = '.v2-panel, .v2-fx-footer, .v2-ed__panel, .v2-ed__status'

const MEASURE_CLASS = 'v2-panel-measuring'
const COMPACT_FLOOR = 200

type SizeHooks = {
  /** Call while panels are still visible (before clearing data-v2-selected). */
  beforeHide: () => void
  /** Call after data-v2-selected is set and panels are shown. */
  afterShow: () => void
  /** Re-apply from setting toggle / first layout. */
  apply: () => void
}

const HOOKS = new WeakMap<object, SizeHooks>()

export function applyPanelOnSelectSetting(
  rows: Array<{ key: string; value: unknown }>,
): void {
  const row = rows.find((r) => r.key === PANEL_ON_SELECT_SETTING)
  const on = row?.value === true
  const was = document.body.hasAttribute(PANEL_ON_SELECT_ATTR)
  document.body.toggleAttribute(PANEL_ON_SELECT_ATTR, on)
  if (was !== on) {
    document.dispatchEvent(new CustomEvent(PANEL_ON_SELECT_CHANGE, { detail: { on } }))
  }
}

export function isPanelOnSelectEnabled(): boolean {
  return document.body.hasAttribute(PANEL_ON_SELECT_ATTR)
}

/** Used by shellChrome syncSelected — must run before/after the selected attribute flip. */
export function panelOnSelectBeforeHide(node: object): void {
  HOOKS.get(node)?.beforeHide()
}

export function panelOnSelectAfterShow(node: object): void {
  HOOKS.get(node)?.afterShow()
}

function outerBlockHeight(el: HTMLElement): number {
  const s = getComputedStyle(el)
  return el.offsetHeight
    + (parseFloat(s.marginTop) || 0)
    + (parseFloat(s.marginBottom) || 0)
}

/**
 * Height of the control stack that panel-on-select hides.
 * Beats `display: none !important` via `.v2-panel-measuring`.
 */
export function measurePanelStackHeight(card: HTMLElement): number {
  let total = 0
  for (const el of card.querySelectorAll<HTMLElement>(PANEL_HIDE_SEL)) {
    const cs = getComputedStyle(el)
    if (cs.display !== 'none') {
      total += outerBlockHeight(el)
      continue
    }
    el.classList.add(MEASURE_CLASS)
    el.style.width = `${card.clientWidth || 320}px`
    total += outerBlockHeight(el)
    el.classList.remove(MEASURE_CLASS)
    el.style.removeProperty('width')
  }
  return Math.round(total)
}

/**
 * Shrink / restore LiteGraph node height when panel-on-select hides the lower panel.
 * Register hooks that shellChrome calls around the data-v2-selected flip.
 */
export function bindPanelOnSelectSize(
  node: ComfyNode,
  card: HTMLElement,
  scope: EffectScope,
): void {
  const anyNode = node as any
  let panelH = 0
  let compact = false

  const widget = (node.widgets ?? []).find((w: any) => w?.name === 'v2_shell') as
    | { options?: { getMinHeight?: () => number } }
    | undefined
  const origGetMinHeight = widget?.options?.getMinHeight
  if (widget?.options) {
    widget.options.getMinHeight = () => {
      const full = typeof origGetMinHeight === 'function' ? Number(origGetMinHeight()) || 300 : 300
      if (!compact || panelH <= 0) return full
      return Math.max(COMPACT_FLOOR, full - panelH)
    }
  }

  const refreshPanelH = () => {
    const h = measurePanelStackHeight(card)
    if (h > 0) panelH = h
    return panelH
  }

  const setHeight = (h: number) => {
    const next = Math.max(COMPACT_FLOOR, Math.round(h))
    if (Math.abs(next - Number(node.size[1])) < 1) return
    node.setSize([node.size[0], next])
    ;(app as any).graph?.setDirtyCanvas?.(true, true)
    anyNode.onResize?.(node.size)
  }

  const compactNow = () => {
    if (!isPanelOnSelectEnabled()) return
    if (compact) return
    if (refreshPanelH() <= 0) return
    compact = true
    setHeight(Number(node.size[1]) - panelH)
  }

  const expandNow = () => {
    if (!compact) {
      refreshPanelH()
      return
    }
    const delta = panelH
    compact = false
    if (delta > 0) setHeight(Number(node.size[1]) + delta)
    requestAnimationFrame(() => { refreshPanelH() })
  }

  const apply = () => {
    if (isPanelOnSelectEnabled() && !anyNode.selected) compactNow()
    else expandNow()
  }

  HOOKS.set(anyNode, {
    beforeHide: () => {
      if (isPanelOnSelectEnabled()) compactNow()
    },
    afterShow: () => {
      if (isPanelOnSelectEnabled()) expandNow()
    },
    apply,
  })

  const onSetting = () => { apply() }
  document.addEventListener(PANEL_ON_SELECT_CHANGE, onSetting)

  const prevSerialize = anyNode.onSerialize
  anyNode.onSerialize = function (obj?: { size?: number[] }, ...rest: unknown[]) {
    prevSerialize?.call(this, obj, ...rest)
    if (compact && panelH > 0 && obj && Array.isArray(obj.size) && obj.size.length >= 2) {
      obj.size = [obj.size[0], obj.size[1] + panelH]
    }
  }

  scope.run(() => {
    useResizeObserver(card, () => {
      if (compact) return
      const before = panelH
      refreshPanelH()
      if (
        isPanelOnSelectEnabled()
        && !anyNode.selected
        && !compact
        && panelH > 0
        && panelH !== before
      ) {
        compactNow()
      }
    })
    onScopeDispose(() => {
      document.removeEventListener(PANEL_ON_SELECT_CHANGE, onSetting)
      HOOKS.delete(anyNode)
      if (widget?.options && origGetMinHeight) {
        widget.options.getMinHeight = origGetMinHeight
      }
    })
  })

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      refreshPanelH()
      apply()
    })
  })
}
