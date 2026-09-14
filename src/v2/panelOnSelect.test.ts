import { afterEach, describe, expect, it } from 'vitest'

import {
  PANEL_ON_SELECT_ATTR,
  applyPanelOnSelectSetting,
  isPanelOnSelectEnabled,
} from './panelOnSelect'

describe('panelOnSelect', () => {
  afterEach(() => {
    document.body.removeAttribute(PANEL_ON_SELECT_ATTR)
  })

  it('toggles the body attribute from settings rows', () => {
    applyPanelOnSelectSetting([
      { key: 'enable-v2', value: true },
      { key: 'v2-panel-on-select', value: true },
    ])
    expect(isPanelOnSelectEnabled()).toBe(true)
    expect(document.body.hasAttribute(PANEL_ON_SELECT_ATTR)).toBe(true)

    applyPanelOnSelectSetting([{ key: 'v2-panel-on-select', value: false }])
    expect(isPanelOnSelectEnabled()).toBe(false)
  })

  it('treats missing setting as off', () => {
    document.body.setAttribute(PANEL_ON_SELECT_ATTR, '')
    applyPanelOnSelectSetting([{ key: 'enable-v2', value: true }])
    expect(isPanelOnSelectEnabled()).toBe(false)
  })
})
