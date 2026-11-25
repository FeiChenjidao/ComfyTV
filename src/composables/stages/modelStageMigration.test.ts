import { describe, expect, it } from 'vitest'

import { migrateModelStageConfigureInfo, normalizeModelStageWidgets } from './modelStageMigration'

const node = {
  widgets: [
    ...Array.from({ length: 28 }, (_, i) => ({ name: `field${i}` })),
    { name: 'selected_index' }, { name: 'pool' }, { name: 'append_results' },
    { name: 'custom_params' }, { name: 'negative' },
  ],
} as any

describe('legacy model stage layout', () => {
  it('preserves prompts, options and custom parameters while inserting history defaults', () => {
    const prefix = Array.from({ length: 28 }, (_, i) => `value${i}`)
    const info = { widgets_values: [...prefix, '{"items":[{"key":"test","value":"kept"}]}', 'negative', ''] }
    expect(migrateModelStageConfigureInfo(node, info)).toBe(true)
    expect(info.widgets_values).toEqual([...prefix, 1, '', true, '{"items":[{"key":"test","value":"kept"}]}', 'negative', ''])
    expect((node.widgets[28] as any).value).toBe(1)
    expect((node.widgets[31] as any).value).toBe('{"items":[{"key":"test","value":"kept"}]}')
    expect(migrateModelStageConfigureInfo(node, info)).toBe(false)
  })

  it('repairs null legacy seeds and non-boolean history flags', () => {
    const saved = { widgets: [{ name: 'seed', value: null }, { name: 'append_results', value: '' }] } as any
    normalizeModelStageWidgets(saved)
    expect(saved.widgets.map((w: any) => w.value)).toEqual([0, true])
    saved.widgets[0].value = 123
    saved.widgets[1].value = false
    normalizeModelStageWidgets(saved)
    expect(saved.widgets.map((w: any) => w.value)).toEqual([123, false])
  })

  it('does not change a current layout or a short partial node', () => {
    const current = { widgets_values: [...Array(28).fill(''), 2, '{"images":[]}', true, '{}', '', ''] }
    const before = structuredClone(current)
    expect(migrateModelStageConfigureInfo(node, current)).toBe(false)
    expect(current).toEqual(before)
    expect(migrateModelStageConfigureInfo(node, { widgets_values: [] })).toBe(false)
  })
})
