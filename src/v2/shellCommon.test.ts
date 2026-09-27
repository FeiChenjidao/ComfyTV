import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { PANEL_ON_SELECT_ATTR } from '@/v2/panelOnSelect'
import { bindCardHeight } from '@/v2/shellCommon'

function metric(el: HTMLElement, key: 'offsetHeight' | 'clientWidth', value: number) {
  Object.defineProperty(el, key, { configurable: true, get: () => value })
}

function hiddenPanel(card: HTMLElement, height: number) {
  const panel = document.createElement('div')
  panel.className = 'v2-panel'
  panel.style.display = 'none'
  metric(panel, 'offsetHeight', height)
  card.appendChild(panel)
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
    const base = real(target as Element)
    if (target !== panel) return base
    return new Proxy(base, {
      get(obj, prop) {
        if (prop === 'display') {
          return panel.classList.contains('v2-panel-measuring') ? 'flex' : 'none'
        }
        if (prop === 'marginTop' || prop === 'marginBottom') return '0px'
        const value = Reflect.get(obj, prop)
        return typeof value === 'function' ? value.bind(obj) : value
      },
    }) as CSSStyleDeclaration
  })
}

function makeNode(height: number, previewHeight?: number) {
  return {
    selected: false,
    size: [340, height],
    properties: previewHeight == null ? {} : { v2_preview_height: previewHeight },
    setSize(value: [number, number]) { this.size = value },
  } as any
}

function mount(cardHeight: number, previewHeight: number, storedPreview?: number) {
  const card = document.createElement('div')
  const preview = document.createElement('div')
  card.appendChild(preview)
  hiddenPanel(card, 250)
  metric(card, 'offsetHeight', cardHeight)
  metric(card, 'clientWidth', 340)
  metric(preview, 'offsetHeight', previewHeight)
  const node = makeNode(cardHeight, storedPreview)
  const scope = effectScope(true)
  bindCardHeight(node, { scope, card, flexible: preview, min: 170 })
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  return { node, scope }
}

describe('bindCardHeight', () => {
  afterEach(() => {
    document.body.removeAttribute(PANEL_ON_SELECT_ATTR)
    vi.restoreAllMocks()
  })

  it('restores preview height independently when an unselected workflow remounts', () => {
    document.body.setAttribute(PANEL_ON_SELECT_ATTR, '')
    const { node, scope } = mount(500, 450, 200)

    expect(node.size[1]).toBe(250)
    expect(node.properties.v2_preview_height).toBe(200)
    scope.stop()
  })

  it('migrates a legacy selected height without shrinking an already compact card', () => {
    document.body.setAttribute(PANEL_ON_SELECT_ATTR, '')
    const legacy = mount(500, 450)
    expect(legacy.node.size[1]).toBe(250)
    expect(legacy.node.properties.v2_preview_height).toBe(200)
    legacy.scope.stop()

    vi.restoreAllMocks()
    const compact = mount(250, 200)
    expect(compact.node.size[1]).toBe(250)
    expect(compact.node.properties.v2_preview_height).toBe(200)
    compact.scope.stop()
  })
})
