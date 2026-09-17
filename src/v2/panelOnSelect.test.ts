import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import {
  PANEL_ON_SELECT_ATTR,
  PANEL_ON_SELECT_CHANGE,
  applyPanelOnSelectSetting,
  bindPanelOnSelectSize,
  isPanelOnSelectEnabled,
  measurePanelStackHeight,
  panelOnSelectAfterShow,
  panelOnSelectBeforeHide,
} from './panelOnSelect'

function mockPanelMetrics(panel: HTMLElement, height: number, marginTop = 0) {
  Object.defineProperty(panel, 'offsetHeight', {
    configurable: true,
    get: () => {
      if (panel.style.display === 'none' && !panel.classList.contains('v2-panel-measuring')) {
        return 0
      }
      return height
    },
  })
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target) => {
    const base = real(target as Element)
    if (target !== panel) return base
    return new Proxy(base, {
      get(obj, prop) {
        if (prop === 'marginTop') return `${marginTop}px`
        if (prop === 'marginBottom') return '0px'
        if (prop === 'display') {
          if (panel.classList.contains('v2-panel-measuring')) return 'flex'
          if (panel.style.display === 'none') return 'none'
          return 'flex'
        }
        const v = Reflect.get(obj, prop)
        return typeof v === 'function' ? v.bind(obj) : v
      },
    }) as CSSStyleDeclaration
  })
}

describe('panelOnSelect', () => {
  afterEach(() => {
    document.body.removeAttribute(PANEL_ON_SELECT_ATTR)
    vi.restoreAllMocks()
  })

  it('toggles the body attribute from settings rows', () => {
    applyPanelOnSelectSetting([
      { key: 'enable-v2', value: true },
      { key: 'v2-panel-on-select', value: true },
    ])
    expect(isPanelOnSelectEnabled()).toBe(true)

    applyPanelOnSelectSetting([{ key: 'v2-panel-on-select', value: false }])
    expect(isPanelOnSelectEnabled()).toBe(false)
  })

  it('treats missing setting as off', () => {
    document.body.setAttribute(PANEL_ON_SELECT_ATTR, '')
    applyPanelOnSelectSetting([{ key: 'enable-v2', value: true }])
    expect(isPanelOnSelectEnabled()).toBe(false)
  })

  it('dispatches a change event when the setting flips', () => {
    const seen: boolean[] = []
    const onChange = (e: Event) => {
      seen.push(!!(e as CustomEvent).detail?.on)
    }
    document.addEventListener(PANEL_ON_SELECT_CHANGE, onChange)
    applyPanelOnSelectSetting([{ key: 'v2-panel-on-select', value: true }])
    applyPanelOnSelectSetting([{ key: 'v2-panel-on-select', value: true }])
    applyPanelOnSelectSetting([{ key: 'v2-panel-on-select', value: false }])
    document.removeEventListener(PANEL_ON_SELECT_CHANGE, onChange)
    expect(seen).toEqual([true, false])
  })
})

describe('measurePanelStackHeight / bindPanelOnSelectSize', () => {
  afterEach(() => {
    document.body.removeAttribute(PANEL_ON_SELECT_ATTR)
    vi.restoreAllMocks()
  })

  it('measures visible panel height including margin', () => {
    const card = document.createElement('div')
    const panel = document.createElement('div')
    panel.className = 'v2-panel'
    card.appendChild(panel)
    mockPanelMetrics(panel, 120, 14)
    expect(measurePanelStackHeight(card)).toBe(134)
  })

  it('measures hidden panels via measuring class (beats display:none)', () => {
    const card = document.createElement('div')
    Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => 320 })
    const panel = document.createElement('div')
    panel.className = 'v2-panel'
    panel.style.display = 'none'
    card.appendChild(panel)
    mockPanelMetrics(panel, 100, 0)
    expect(measurePanelStackHeight(card)).toBe(100)
    expect(panel.classList.contains('v2-panel-measuring')).toBe(false)
  })

  it('shrinks via beforeHide while panel is visible, restores via afterShow', () => {
    document.body.setAttribute(PANEL_ON_SELECT_ATTR, '')
    const card = document.createElement('div')
    const panel = document.createElement('div')
    panel.className = 'v2-panel'
    card.appendChild(panel)
    mockPanelMetrics(panel, 150, 0)

    const node: any = {
      selected: true,
      size: [320, 460],
      setSize(v: [number, number]) { this.size = v },
      widgets: [{ name: 'v2_shell', options: { getMinHeight: () => 420 } }],
    }
    const scope = effectScope(true)
    bindPanelOnSelectSize(node, card, scope)

    // Mimic shellChrome syncSelected: beforeHide → clear attr/hide → …
    panelOnSelectBeforeHide(node)
    panel.style.display = 'none'
    node.selected = false
    expect(node.size[1]).toBe(310)
    expect(node.widgets[0].options.getMinHeight()).toBe(270)

    node.selected = true
    panel.style.display = ''
    panelOnSelectAfterShow(node)
    expect(node.size[1]).toBe(460)

    panelOnSelectBeforeHide(node)
    expect(node.size[1]).toBe(310)
    const saved: { size: number[] } = { size: [node.size[0], node.size[1]] }
    node.onSerialize?.(saved)
    expect(saved.size[1]).toBe(460)

    scope.stop()
  })

  it('compacts on attach when already unselected and panels CSS-hidden', async () => {
    document.body.setAttribute(PANEL_ON_SELECT_ATTR, '')
    const card = document.createElement('div')
    Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => 320 })
    const panel = document.createElement('div')
    panel.className = 'v2-panel'
    panel.style.display = 'none'
    card.appendChild(panel)
    mockPanelMetrics(panel, 150, 0)

    const node: any = {
      selected: false,
      size: [320, 460],
      setSize(v: [number, number]) { this.size = v },
      widgets: [{ name: 'v2_shell', options: { getMinHeight: () => 420 } }],
    }
    const scope = effectScope(true)
    bindPanelOnSelectSize(node, card, scope)

    await vi.waitFor(() => expect(node.size[1]).toBe(310))
    scope.stop()
  })
})
