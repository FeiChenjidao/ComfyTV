import { useResizeObserver } from '@vueuse/core'
import { h, onScopeDispose, watch, type EffectScope } from 'vue'

import { t } from '@/i18n'
import { app, type ComfyNode } from '@/lib/comfyApp'
import { isPoolPickerKind, useStageStore, type StageState } from '@/stores/stageStore'
import { createIslandGroup } from '@/v2/islands'
import { pickedMediaItem, type MediaSource } from '@/v2/mediaItems'
import MediaMetaV2 from '@/v2/MediaMetaV2.vue'
import { bindClusterHoverIntent, nudgeSlotAnchors } from '@/v2/nodeDrag'
import { observeProperty } from '@/v2/observeProps'
import { bindLodPoster, registerCull } from '@/v2/lodV2'
import { cancelMeasure, scheduleMeasure } from '@/v2/measureBatch'
import {
  bindPanelOnSelectSize,
  isPanelOnSelectEnabled,
  panelOnSelectAfterShow,
  panelOnSelectBeforeHide,
} from '@/v2/panelOnSelect'
import { bindCardHeight, el, stopNativeAutoGrow } from '@/v2/shellCommon'

export function bindShellChrome(node: ComfyNode, opts: {
  scope: EffectScope
  card: HTMLElement
  socketAnchor: HTMLElement
  /** When set, socket Y tracks this box (e.g. `.v2-ed__canvas`) instead of `socketAnchor`. */
  socketBox?: () => HTMLElement | null | undefined
  socketY?: 'center' | { frac: number; cap: number }
  state?: StageState
  media?: { source: MediaSource; host?: HTMLElement; preferImageInput?: boolean }
  lod?: boolean
  manageHeight?: { min: number }
}) {
  const anyNode = node as any
  const { scope, card, socketAnchor } = opts
  const socketY = opts.socketY ?? 'center'
  const boxEl = () => opts.socketBox?.() || socketAnchor

  stopNativeAutoGrow(node)
  let syncHeight: (() => void) | null = null
  if (opts.manageHeight) {
    syncHeight = bindCardHeight(node, {
      scope, card, flexible: socketAnchor, min: opts.manageHeight.min,
    })
    anyNode.__comfytvSyncHeight = syncHeight
    // LiteGraph uses getMinHeight as a floor. A fixed 420+ would re-inflate a
    // user-shrunk card on tab remount; follow the live node height instead.
    const shell = (node.widgets ?? []).find((w: any) => w?.name === 'v2_shell') as
      | { options?: { getMinHeight?: () => number } }
      | undefined
    if (shell?.options) {
      const floor = opts.manageHeight.min
      shell.options.getMinHeight = () => Math.max(floor, Math.round(Number(node.size[1]) || floor))
    }
  }

  const warnStrip = el('div', 'v2-warn')
  socketAnchor.after(warnStrip)
  let lastWarnKey = ''
  const syncWarnings = (root: HTMLElement) => {
    const map = (anyNode._comfytvSlotWarnings ?? {}) as Record<string, { message: string }>
    const msgs = [...new Set(Object.values(map).map((w) => String(w?.message ?? '')).filter(Boolean))]
    const key = msgs.join('\n')
    root.toggleAttribute('data-v2-warn', msgs.length > 0)
    if (key === lastWarnKey) return
    lastWarnKey = key
    warnStrip.dataset.show = msgs.length ? '1' : ''
    warnStrip.replaceChildren(...msgs.slice(0, 4).map((m) => {
      const row = el('div', 'v2-warn__row')
      row.textContent = m
      return row
    }))
  }

  if (opts.state) {
    const state = opts.state
    const strip = el('div', 'v2-error')
    const msg = el('div', 'v2-error__msg')
    const x = el('button', 'v2-error__x', '×') as HTMLButtonElement
    strip.append(msg, x)
    warnStrip.after(strip)
    x.addEventListener('pointerdown', (e) => e.stopPropagation())
    x.addEventListener('click', (e) => {
      e.stopPropagation()
      useStageStore().clearError(state as any)
    })
    scope.run(() => {
      watch(
        () => state.error,
        (err) => {
          strip.dataset.show = err ? '1' : ''
          const text = String(err?.message ?? '').trim()
          msg.textContent = text
          msg.title = String(err?.traceback ?? '').trim() || text
        },
        { immediate: true },
      )
    })
    bindMediaMeta(state, opts.media, socketAnchor, scope)
    if (opts.lod && opts.media) {
      bindLodPoster(card, socketAnchor, state, opts.media.source, scope, {
        preferImageInput: opts.media.preferImageInput,
      })
    }
  }

  const titleEl = card.querySelector<HTMLElement>('.v2-handle span')
  const typeLabel = titleEl?.textContent ?? ''
  const defaultTitle = String((node.constructor as any)?.title ?? '')
  const customTitle = () => {
    const raw = String(anyNode.title ?? '').trim()
    return raw && raw !== defaultTitle ? raw : ''
  }
  const syncTitle = () => {
    if (!titleEl || titleEl.isContentEditable) return
    const want = customTitle() || typeLabel
    if (titleEl.textContent !== want) titleEl.textContent = want
  }
  if (titleEl) {
    titleEl.title = t('v2.renameHint')
    titleEl.addEventListener('pointerdown', (e) => {
      if (titleEl.isContentEditable) e.stopPropagation()
    })
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      titleEl.contentEditable = 'plaintext-only'
      titleEl.textContent = customTitle()
      titleEl.focus()
      const range = document.createRange()
      range.selectNodeContents(titleEl)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    const commit = (cancel: boolean) => {
      if (!titleEl.isContentEditable) return
      const text = (titleEl.textContent ?? '').trim()
      titleEl.contentEditable = 'false'
      if (!cancel) anyNode.title = text || defaultTitle
      syncTitle()
    }
    titleEl.addEventListener('keydown', (e) => {
      if (!titleEl.isContentEditable) return
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); commit(false) }
      else if (e.key === 'Escape') { e.preventDefault(); commit(true) }
    })
    titleEl.addEventListener('blur', () => commit(false))
    syncTitle()
  }

  const ID_SETTING = 'Comfy.NodeBadge.NodeIdBadgeMode'
  const idEl = el('span', 'v2-id')
  titleEl?.parentElement?.appendChild(idEl)
  const syncId = () => {
    const mode = (app as any).ui?.settings?.getSettingValue?.(ID_SETTING)
    const show = !!mode && mode !== 'None' && anyNode.id != null && anyNode.id !== -1
    idEl.textContent = show ? `#${anyNode.id}` : ''
    idEl.dataset.show = show ? '1' : ''
  }
  const settingsBus = (app as any).ui?.settings as EventTarget | undefined
  settingsBus?.addEventListener(`${ID_SETTING}.change`, syncId)
  scope.run(() => {
    onScopeDispose(() => settingsBus?.removeEventListener(`${ID_SETTING}.change`, syncId))
  })

  const syncSelected = () => {
    const root = card.closest('[data-node-id]') as HTMLElement | null
    if (!root) return
    const next = !!anyNode.selected
    const was = root.hasAttribute('data-v2-selected')
    // Delta hooks no-op when bindPanelOnSelectSize was not registered (manageHeight cards).
    if (was && !next) panelOnSelectBeforeHide(anyNode)
    root.toggleAttribute('data-v2-selected', next)
    if (!was && next) panelOnSelectAfterShow(anyNode)
    // manageHeight: after CSS shows/hides the panel, let bindCardHeight re-read chrome once.
    // Do not ±panel deltas here — that raced corner-resize and select flicker.
    if (syncHeight && isPanelOnSelectEnabled() && was !== next) {
      requestAnimationFrame(() => syncHeight?.())
    }
    queueMicrotask(() => {
      document.body.toggleAttribute(
        'data-v2-toolbar',
        !!document.querySelector('.lg-node[data-v2-selected]'),
      )
    })
  }
  const prevSel = anyNode.onSelected
  anyNode.onSelected = function (...args: unknown[]) {
    prevSel?.apply(this, args)
    syncSelected()
  }
  const prevDesel = anyNode.onDeselected
  anyNode.onDeselected = function (...args: unknown[]) {
    prevDesel?.apply(this, args)
    syncSelected()
  }

  let root: HTMLElement | null = null
  let unregisterCull: (() => void) | null = null
  let nudgedY = Number.NEGATIVE_INFINITY

  const syncSocketY = () => {
    if (!root) return
    scheduleMeasure(card, () => {
      const r = root
      if (!r || !card.isConnected) return null
      const rootBox = r.getBoundingClientRect()
      const align = boxEl()
      const box = align.getBoundingClientRect()
      if (!(rootBox.height > 0 && box.height > 0)) return null
      const scale = rootBox.height / (r.offsetHeight || rootBox.height)
      const mid = socketY === 'center'
        ? box.height / 2
        : Math.min(box.height * socketY.frac, socketY.cap)
      const y = Math.round((box.top + mid - rootBox.top) / (scale || 1))
      return () => {
        r.style.setProperty('--v2-socket-y', `${y}px`)
        if (Math.abs(y - nudgedY) >= 2) {
          nudgedY = y
          nudgeSlotAnchors(r)
        }
      }
    })
  }

  const syncAll = () => {
    if (!card.isConnected) return
    const r = card.closest('[data-node-id]') as HTMLElement | null
    if (!r) return
    if (r !== root) {
      root = r
      bindClusterHoverIntent(root, scope)
      unregisterCull?.()
      unregisterCull = registerCull(node, root)
    }
    if (!root.hasAttribute('data-v2-shell')) root.setAttribute('data-v2-shell', '')
    syncSelected()
    syncTitle()
    syncId()
    syncWarnings(root)
    syncSocketY()
  }

  scope.run(() => {
    useResizeObserver(card, syncAll)
    useResizeObserver(socketAnchor, syncSocketY)
  })

  // manageHeight cards already size via bindCardHeight (chrome + wanted). Delta-based
  // bindPanelOnSelectSize must not also run — the two fought on corner-resize release.
  if (!opts.manageHeight) bindPanelOnSelectSize(node, card, scope)

  const disposers = [
    observeProperty(anyNode, 'selected', syncSelected),
    observeProperty(anyNode, 'title', syncTitle),
    observeProperty(anyNode, 'id', syncId),
    observeProperty(anyNode, '_comfytvSlotWarnings', () => { if (root) syncWarnings(root) }),
  ]
  scope.run(() => {
    onScopeDispose(() => {
      cancelMeasure(card)
      unregisterCull?.()
      for (const d of disposers) d()
    })
  })

  const prevConf = anyNode.onConfigure
  anyNode.onConfigure = function (...args: unknown[]) {
    prevConf?.apply(this, args)
    queueMicrotask(syncAll)
  }

  queueMicrotask(syncAll)
}

function bindMediaMeta(
  state: StageState,
  media: { source: MediaSource; host?: HTMLElement } | undefined,
  socketAnchor: HTMLElement,
  scope: EffectScope,
) {
  let host = media?.host
  if (!host) {
    host = el('div', 'v2-meta-host')
    socketAnchor.after(host)
  }
  const showGenTime = state.variant !== 'loader' && !isPoolPickerKind(state.kind)
  const islands = createIslandGroup()
  islands.mount(host, {
    render: () => h(MediaMetaV2, {
      url: media ? pickedMediaItem(state, media.source)?.url ?? null : null,
      durationMs: showGenTime && state.output ? state.durationMs ?? null : null,
    }),
  })
  scope.run(() => onScopeDispose(() => islands.unmountAll()))
}
