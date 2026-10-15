/**
 * Configurable floating top toolbar (`.v2-toolbar`) for V2 shells.
 *
 * Shells declare a `toolbar` 配表 (preset name or item list). Custom actions are
 * handled via `registerToolbarHandlers` on the LiteGraph node so Vue editors can
 * own the behavior (e.g. Images Split merge / 1:1 / generate).
 *
 * Custom 配表 toolbars are built as plain DOM (same as the image output toolbar)
 * so they never depend on Vue island mount timing / circular imports — an empty
 * bar would be hidden by `.v2-toolbar:empty { display: none }`.
 */
import { reactive } from 'vue'

import { t } from '@/i18n'
import type { ComfyNode } from '@/lib/comfyApp'
import type { StageKind, StageState } from '@/stores/stageStore'
import { createIslandGroup } from '@/v2/islands'
import {
  attachImageToolbar,
  downloadUrl,
  outputImageUrl,
} from '@/v2/imageToolbar'
import MediaToolbarV2, { type MediaToolbarFlavor } from '@/v2/MediaToolbarV2.vue'
import { I, el } from '@/v2/shellCommon'

export type NodeToolbarSep = { type: 'sep' }

export type NodeToolbarAction = {
  id: string
  /** i18n key for visible label (omit for icon-only) */
  labelKey?: string
  /** i18n key for tooltip; defaults to labelKey */
  titleKey?: string
  /** Inline SVG markup */
  icon?: string
}

export type NodeToolbarItem = NodeToolbarSep | NodeToolbarAction

/** Built-in media toolbars, or an explicit item list (配表). */
export type NodeToolbarConfig =
  | 'image'
  | 'video'
  | 'audio'
  | 'none'
  | false
  | NodeToolbarItem[]

export type ToolbarHandlers = Record<string, () => void>

export type VideoToolbarFlavor = 'video' | 'vfx'

type ToolbarRuntime = {
  handlers: ToolbarHandlers
  disabled: Record<string, boolean>
}

const RUNTIME = new WeakMap<object, ToolbarRuntime>()
const BAR_BTNS = new WeakMap<HTMLElement, Map<string, HTMLButtonElement>>()
const NODE_BARS = new WeakMap<object, HTMLElement>()

export function toolbarRuntime(node: object): ToolbarRuntime {
  let rt = RUNTIME.get(node)
  if (!rt) {
    rt = reactive({ handlers: {}, disabled: {} })
    RUNTIME.set(node, rt)
  }
  return rt
}

/** Register action handlers; returns disposer. */
export function registerToolbarHandlers(
  node: object,
  handlers: ToolbarHandlers,
): () => void {
  const rt = toolbarRuntime(node)
  Object.assign(rt.handlers, handlers)
  return () => {
    for (const id of Object.keys(handlers)) delete rt.handlers[id]
  }
}

/** Update disabled map for toolbar buttons. */
export function setToolbarDisabled(
  node: object,
  disabled: Record<string, boolean>,
): void {
  const rt = toolbarRuntime(node)
  for (const [id, on] of Object.entries(disabled)) {
    rt.disabled[id] = on
  }
  const bar = NODE_BARS.get(node)
  if (bar) syncBarDisabled(bar, rt.disabled)
}

export function dispatchToolbarAction(node: object, id: string): boolean {
  const fn = RUNTIME.get(node)?.handlers[id]
  if (!fn) return false
  fn()
  return true
}

export function isToolbarAction(item: NodeToolbarItem): item is NodeToolbarAction {
  return (item as NodeToolbarSep).type !== 'sep'
}

/** Resolve a shell `toolbar` config into concrete items (null = use kind default). */
export function resolveToolbarConfig(
  cfg: NodeToolbarConfig | undefined,
): NodeToolbarItem[] | 'image' | 'video' | 'audio' | 'none' | null {
  if (cfg === undefined) return null
  if (cfg === false || cfg === 'none') return 'none'
  if (cfg === 'image' || cfg === 'video' || cfg === 'audio') return cfg
  return cfg
}

export function toolbarLabel(item: NodeToolbarAction): string {
  return item.labelKey ? t(item.labelKey) : ''
}

export function toolbarTitle(item: NodeToolbarAction): string {
  const key = item.titleKey || item.labelKey
  return key ? t(key) : item.id
}

/** Build a DOM toolbar from a 配表 (always non-empty when items has actions). */
export function buildToolbarFromItems(
  items: NodeToolbarItem[],
  dispatch: (actionId: string) => void,
  disabled: Record<string, boolean> = {},
): HTMLElement {
  const bar = el('div', 'v2-toolbar')
  const btns = new Map<string, HTMLButtonElement>()
  for (const item of items) {
    if (!isToolbarAction(item)) {
      bar.appendChild(el('div', 'v2-toolbar__sep'))
      continue
    }
    const label = toolbarLabel(item)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = label
      ? 'v2-toolbar__btn'
      : 'v2-toolbar__btn v2-toolbar__btn--icononly'
    btn.dataset.action = item.id
    btn.title = toolbarTitle(item)
    btn.disabled = !!disabled[item.id]
    btn.innerHTML = item.icon
      ? (label ? `${item.icon}<span>${label}</span>` : item.icon)
      : (label ? `<span>${label}</span>` : item.id)
    btn.addEventListener('pointerdown', (e) => e.stopPropagation())
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (btn.disabled) return
      dispatch(item.id)
    })
    bar.appendChild(btn)
    btns.set(item.id, btn)
  }
  BAR_BTNS.set(bar, btns)
  return bar
}

function syncBarDisabled(bar: HTMLElement, disabled: Record<string, boolean>) {
  const btns = BAR_BTNS.get(bar)
  if (!btns) return
  for (const [id, btn] of btns) {
    btn.disabled = !!disabled[id]
  }
}

export function attachConfiguredToolbar(opts: {
  node: ComfyNode
  card: HTMLElement
  kind: StageKind
  state: StageState
  onAction: (actionId: string, context?: any) => void
  toolbar?: NodeToolbarConfig
  videoFlavor?: VideoToolbarFlavor
  islands?: ReturnType<typeof createIslandGroup>
}): HTMLElement | null {
  // Replace any previous bar on this card (remount / configure).
  opts.card.querySelectorAll(':scope > .v2-toolbar').forEach((n) => n.remove())

  const resolved = resolveToolbarConfig(opts.toolbar)
  if (resolved === 'none') return null
  if (resolved === 'image' || resolved === 'video' || resolved === 'audio') {
    return attachPresetToolbar(opts, resolved)
  }
  if (resolved === null) {
    return attachDefaultMediaToolbar(opts)
  }

  const rt = toolbarRuntime(opts.node)
  const bar = buildToolbarFromItems(resolved, (id) => {
    if (dispatchToolbarAction(opts.node, id)) return
    if (id === 'download') {
      downloadUrl(outputImageUrl(opts.state))
      return
    }
    opts.onAction(id)
  }, rt.disabled)
  opts.card.appendChild(bar)
  NODE_BARS.set(opts.node, bar)
  return bar
}

function attachPresetToolbar(
  opts: {
    node: ComfyNode
    card: HTMLElement
    kind: StageKind
    state: StageState
    onAction: (actionId: string, context?: any) => void
    videoFlavor?: VideoToolbarFlavor
    islands?: ReturnType<typeof createIslandGroup>
  },
  preset: 'image' | 'video' | 'audio',
): HTMLElement | null {
  if (preset === 'image') {
    return attachImageToolbar(opts.card, 'image', opts.state, opts.onAction)
  }
  const flavor: MediaToolbarFlavor = preset === 'video'
    ? (opts.videoFlavor ?? 'video')
    : 'audio'
  const bar = el('div', 'v2-toolbar')
  opts.card.appendChild(bar)
  const islands = opts.islands ?? createIslandGroup()
  islands.mount(bar, MediaToolbarV2, { state: opts.state, flavor, onAction: opts.onAction })
  return bar
}

function attachDefaultMediaToolbar(opts: {
  node: ComfyNode
  card: HTMLElement
  kind: StageKind
  state: StageState
  onAction: (actionId: string, context?: any) => void
  videoFlavor?: VideoToolbarFlavor
  islands?: ReturnType<typeof createIslandGroup>
}): HTMLElement | null {
  if (opts.kind === 'image' || opts.kind === 'image-batch' || opts.kind === 'image-picker') {
    return attachPresetToolbar(opts, 'image')
  }
  if (opts.kind === 'video' || opts.kind === 'video-picker') {
    return attachPresetToolbar(opts, 'video')
  }
  if (opts.kind === 'audio' || opts.kind === 'audio-picker') {
    return attachPresetToolbar(opts, 'audio')
  }
  return null
}

/** Images Split top-bar 配表 */
export const IMAGES_SPLIT_TOOLBAR: NodeToolbarItem[] = [
  { id: 'split:merge', labelKey: 'imagesSplit.merge', icon: I(`<rect x="4" y="6" width="11" height="11" rx="1.5"/><rect x="9" y="9" width="11" height="11" rx="1.5"/>`) },
  { id: 'split:square', labelKey: 'imagesSplit.aspect11', icon: I(`<rect x="4" y="4" width="16" height="16" rx="2"/>`) },
  { id: 'split:flip-h', labelKey: 'imagesSplit.flipH', titleKey: 'imagesSplit.flipH', icon: I(`<path d="M12 4v16" stroke-dasharray="2.2 2.2"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>`) },
  { id: 'split:flip-v', labelKey: 'imagesSplit.flipV', titleKey: 'imagesSplit.flipV', icon: I(`<path d="M4 12h16" stroke-dasharray="2.2 2.2"/><path d="M8 8l4-4 4 4M8 16l4 4 4-4"/>`) },
  { id: 'split:generate', labelKey: 'imagesSplit.generate', icon: I(`<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M8 14l2.2-3 1.8 2.2L15 10l3 4"/>`) },
]

/** Small helpers for common icons (optional use in 配表). */
export const TOOLBAR_ICONS = {
  square: I(`<rect x="4" y="4" width="16" height="16" rx="2"/>`),
  merge: I(`<rect x="4" y="6" width="11" height="11" rx="1.5"/><rect x="9" y="9" width="11" height="11" rx="1.5"/>`),
  flipH: I(`<path d="M12 4v16" stroke-dasharray="2.2 2.2"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>`),
  flipV: I(`<path d="M4 12h16" stroke-dasharray="2.2 2.2"/><path d="M8 8l4-4 4 4M8 16l4 4 4-4"/>`),
  generate: I(`<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M8 14l2.2-3 1.8 2.2L15 10l3 4"/>`),
}
