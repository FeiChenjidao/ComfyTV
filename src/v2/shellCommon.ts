import { useResizeObserver, useTimeoutFn } from '@vueuse/core'
import { effectScope, watch, type EffectScope } from 'vue'

import { app, type ComfyNode } from '@/lib/comfyApp'
import { isPanelOnSelectEnabled, measurePanelStackHeight } from '@/v2/panelOnSelect'

const RING_FADE_MS = 400
const PREVIEW_HEIGHT_PROP = 'v2_preview_height'

export const I = (d: string, sw = 1.7) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}">${d}</svg>`
export const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>`
export const RUN_BUTTON_HTML = `<span class="v2-run__up">${I(`<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>`, 2.4)}</span><span class="v2-run__stop">${ICON_STOP}</span>`

export const ICON_GRIP = `<svg class="v2-grip" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="5" r="1.7"/><circle cx="16" cy="5" r="1.7"/><circle cx="8" cy="12" r="1.7"/><circle cx="16" cy="12" r="1.7"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/></svg>`

export function el(tag: string, cls: string, html?: string) {
  const e = document.createElement(tag)
  e.className = cls
  if (html != null) e.innerHTML = html
  return e
}

function growNodeHeight(node: ComfyNode, delta: number) {
  if (Math.abs(delta) <= 1) return
  node.setSize([node.size[0], node.size[1] + delta])
  ;(app as any).graph?.setDirtyCanvas?.(true, true)
}

export function stopNativeAutoGrow(node: ComfyNode) {
  // V2 slots float outside layout, so litegraph's natural size would only fight the card.
  // Both core auto-size paths read computeSize(), so pinning it here covers them all.
  ;(node as any).computeSize = () => [node.size[0], node.size[1]]
}

// The card owns the node height: height = chrome + the flexible block's wanted height.
// Persist wanted separately because panel-on-select can hide the chrome before a workflow
// remounts; node.size alone cannot distinguish preview from preview + panel in that state.
export function bindCardHeight(node: ComfyNode, opts: {
  scope: EffectScope
  card: HTMLElement
  flexible: HTMLElement
  min: number
}): () => void {
  const anyNode = node as any
  const { card, flexible, min } = opts
  const laidOut = () => card.offsetHeight > 0
  const measurable = () => laidOut() && flexible.offsetHeight > 0
  const chromeOf = () => card.offsetHeight - flexible.offsetHeight

  let chrome = -1
  let applied = -1
  const stored = Number(anyNode.properties?.[PREVIEW_HEIGHT_PROP])
  let hasStoredWanted = Number.isFinite(stored) && stored >= min
  let wanted = hasStoredWanted ? Math.max(min, Math.round(stored)) : 0
  // the card is taller than node.size by a constant (the hidden title row); measure it
  // whenever the DOM and node.size are known to agree, and work in DOM space throughout.
  let offset = 0
  let live = false

  const rememberWanted = (height: number) => {
    wanted = Math.max(min, Math.round(height))
    ;(anyNode.properties ??= {})[PREVIEW_HEIGHT_PROP] = wanted
    hasStoredWanted = true
  }

  const initialWanted = (): number | null => {
    if (hasStoredWanted) return wanted
    let height = flexible.offsetHeight
    if (isPanelOnSelectEnabled() && !anyNode.selected) {
      const panelH = measurePanelStackHeight(card)
      if (panelH <= 0) return null
      // Old workflows saved the selected height. On an unselected remount flex gives
      // the hidden panel's space to the preview, so migrate that extra height once.
      const withoutPanel = height - panelH
      if (withoutPanel >= min) height = withoutPanel
    }
    return Math.max(min, height)
  }

  const sample = (initial: boolean): boolean => {
    const height = initial ? initialWanted() : Math.max(min, flexible.offsetHeight)
    if (height == null) return false
    chrome = chromeOf()
    offset = card.offsetHeight - node.size[1]
    rememberWanted(height)
    applied = node.size[1]
    return true
  }

  const activate = (): boolean => {
    if (live) return true
    if (!measurable() || !sample(true)) return false
    live = true
    return true
  }

  const apply = () => {
    if (!activate() || !laidOut()) return
    chrome = chromeOf()
    const h = chrome + wanted - offset
    applied = h
    if (Math.abs(h - node.size[1]) < 1) return
    node.setSize([node.size[0], h])
    ;(app as any).graph?.setDirtyCanvas?.(true, true)
  }

  card.dataset.v2Height = '1'
  card.addEventListener('pointerdown', apply, { capture: true })
  const prevConn = anyNode.onConnectionsChange
  anyNode.onConnectionsChange = function (...args: unknown[]) {
    apply()
    return prevConn?.apply(this, args)
  }

  opts.scope.run(() => {
    const onResize = () => {
      if (!laidOut()) return
      if (!live) {
        if (hasStoredWanted) apply()
        else chrome = chromeOf()
        return
      }
      // chrome moved: we drive the node. chrome steady but the card moved: the user did.
      if (chromeOf() !== chrome) apply()
      else if (measurable() && Math.abs(node.size[1] - applied) >= 1) sample(false)
    }
    useResizeObserver(card, onResize)
    useResizeObserver(flexible, onResize)
  })
  if (hasStoredWanted) requestAnimationFrame(() => requestAnimationFrame(apply))
  return apply
}

export function bindPromptResize(node: ComfyNode, promptAnchor: HTMLElement, scope: EffectScope) {
  scope.run(() => {
    let last = -1
    useResizeObserver(promptAnchor, (entries) => {
      const h = entries[0]?.contentRect.height ?? 0
      if (h <= 0) return
      if (last >= 0) {
        const delta = h - last
        growNodeHeight(node, delta)
      }
      last = h
    })
  })
}

export function hideNativeWidgets(node: ComfyNode, keep: readonly string[] = []) {
  for (const w of (node.widgets ?? []) as any[]) {
    if (w.type === 'v2' || keep.includes(w.name)) continue
    ;(w.options ??= {}).hidden = true
    w.hidden = true
  }
}

export function ensureMinSize(node: ComfyNode, minW: number, minH: number) {
  if ((node as any).__comfytvFromSave) return
  const [w0, h0] = node.size
  node.setSize([Math.max(w0, minW), Math.max(h0, minH)])
}

export function createNodeScope(node: ComfyNode): EffectScope {
  const scope = effectScope(true)
  const anyNode = node as any
  const prev = anyNode.onRemoved
  anyNode.onRemoved = function (...args: unknown[]) {
    scope.stop()
    prev?.apply(this, args)
  }
  return scope
}

export function bindProgressRing(
  card: HTMLElement,
  state: { running?: boolean; progress?: { value: number; max: number; text?: string } | null },
) {
  let ring: HTMLDivElement | null = null
  const remove = useTimeoutFn(() => {
    ring?.remove()
    ring = null
    delete card.dataset.v2Running
  }, RING_FADE_MS, { immediate: false })
  watch(
    () => [state.running, state.progress?.value, state.progress?.max] as const,
    ([running, v, m]) => {
      if (!running) {
        if (ring) { ring.dataset.on = ''; remove.start() }
        return
      }
      remove.stop()
      if (!ring) {
        ring = document.createElement('div')
        ring.className = 'v2-ring'
        card.appendChild(ring)
      }
      card.dataset.v2Running = '1'
      const value = Number(v) || 0
      const max = Number(m) || 0
      const p = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
      ring.style.setProperty('--v2-p', p.toFixed(4))
      ring.dataset.on = '1'
      ring.dataset.indeterminate = p <= 0 ? '1' : ''
    },
    { immediate: true },
  )
}
