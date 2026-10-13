/**
 * V2 shells / prompt editors / scroll hosts often keep DOM focus after a node is
 * selected. ComfyUI then ignores Delete/Backspace for graph nodes.
 *
 * Capture-phase: if the user is not typing in a real text field, blur the stuck
 * focus so the canvas delete shortcut can run.
 */
import { app } from '@/lib/comfyApp'

function isRealTextEditing(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLInputElement) {
    if (el.disabled || el.readOnly) return false
    const type = (el.type || 'text').toLowerCase()
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type)
  }
  if (el.isContentEditable) return true
  return el.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') != null
    && !el.closest('button, [role="button"]')
}

function selectedNodeCount(): number {
  const canvas = (app as any)?.canvas
  const items = canvas?.selectedItems
  if (items != null && typeof items.size === 'number') return items.size
  const selected = canvas?.selected_nodes
  if (!selected) return 0
  if (typeof selected.size === 'number') return selected.size
  if (typeof selected[Symbol.iterator] === 'function') return [...selected].length
  return Object.keys(selected).length
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  if (e.defaultPrevented || e.isComposing) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (selectedNodeCount() <= 0) return

  const target = e.target instanceof Element ? e.target : null
  const active = document.activeElement instanceof Element ? document.activeElement : null
  if (isRealTextEditing(target) || isRealTextEditing(active)) return

  const canvasEl = (app as any)?.canvas?.canvas as HTMLElement | undefined
  if (active && active !== document.body && active !== canvasEl) {
    ;(active as HTMLElement).blur?.()
  }
}

export function installDeleteKeyFix(): void {
  window.addEventListener('keydown', onKeydown, true)
}
