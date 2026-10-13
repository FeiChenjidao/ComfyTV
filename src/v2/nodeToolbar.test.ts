import { describe, expect, it, vi } from 'vitest'

import {
  buildToolbarFromItems,
  dispatchToolbarAction,
  registerToolbarHandlers,
  resolveToolbarConfig,
  setToolbarDisabled,
  toolbarRuntime,
  IMAGES_SPLIT_TOOLBAR,
} from './nodeToolbar'

describe('resolveToolbarConfig', () => {
  it('maps false/none to none', () => {
    expect(resolveToolbarConfig(false)).toBe('none')
    expect(resolveToolbarConfig('none')).toBe('none')
  })

  it('passes through presets and item lists', () => {
    expect(resolveToolbarConfig(undefined)).toBeNull()
    expect(resolveToolbarConfig('image')).toBe('image')
    expect(resolveToolbarConfig(IMAGES_SPLIT_TOOLBAR)).toBe(IMAGES_SPLIT_TOOLBAR)
  })
})

describe('toolbar handlers', () => {
  it('dispatches registered handlers and tracks disabled flags', () => {
    const node = {}
    const merge = vi.fn()
    const dispose = registerToolbarHandlers(node, { 'split:merge': merge })
    expect(dispatchToolbarAction(node, 'split:merge')).toBe(true)
    expect(merge).toHaveBeenCalledTimes(1)
    expect(dispatchToolbarAction(node, 'missing')).toBe(false)

    setToolbarDisabled(node, { 'split:merge': true })
    expect(toolbarRuntime(node).disabled['split:merge']).toBe(true)

    dispose()
    expect(dispatchToolbarAction(node, 'split:merge')).toBe(false)
  })
})

describe('buildToolbarFromItems', () => {
  it('renders Images Split 配表 buttons into a non-empty bar', () => {
    const dispatch = vi.fn()
    const bar = buildToolbarFromItems(IMAGES_SPLIT_TOOLBAR, dispatch, {
      'split:merge': true,
    })
    expect(bar.className).toBe('v2-toolbar')
    expect(bar.children.length).toBe(3)
    const mergeBtn = bar.querySelector('[data-action="split:merge"]') as HTMLButtonElement
    expect(mergeBtn).toBeTruthy()
    expect(mergeBtn.disabled).toBe(true)
    const squareBtn = bar.querySelector('[data-action="split:square"]') as HTMLButtonElement
    expect(squareBtn.disabled).toBe(false)
    squareBtn.click()
    expect(dispatch).toHaveBeenCalledWith('split:square')
  })
})
