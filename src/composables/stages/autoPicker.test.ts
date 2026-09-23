import { describe, expect, it } from 'vitest'

import { applyAutoPickerSetting, isAutoPickerEnabled } from '@/composables/stages/autoPicker'

describe('autoPicker setting', () => {
  it('defaults on and follows the auto-picker row', () => {
    expect(isAutoPickerEnabled()).toBe(true)
    applyAutoPickerSetting([{ key: 'auto-picker', value: false }])
    expect(isAutoPickerEnabled()).toBe(false)
    applyAutoPickerSetting([{ key: 'enable-v2', value: true }])
    expect(isAutoPickerEnabled()).toBe(false)
    applyAutoPickerSetting([{ key: 'auto-picker', value: true }])
    expect(isAutoPickerEnabled()).toBe(true)
  })
})
