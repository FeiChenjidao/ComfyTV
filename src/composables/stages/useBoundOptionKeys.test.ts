import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const loadWorkflowInfo = vi.fn(async () => ({} as Record<string, unknown>))
vi.mock('@/composables/stages/useWorkflowValidator', () => ({
  loadWorkflowInfo: () => loadWorkflowInfo(),
}))
vi.mock('@/composables/stages/workflowCombo', () => ({
  comboOptionsVersion: { value: 0 },
}))
vi.mock('@/utils/widget', () => ({
  getWidget: (node: any, name: string) =>
    node?.widgets?.find((w: any) => w.name === name),
  bindWidgetCallback: (node: any, name: string, apply: (value: unknown) => void) => {
    const widget = node?.widgets?.find((w: any) => w.name === name)
    if (!widget) return () => {}
    const original = widget.callback
    widget.callback = (value: unknown) => {
      original?.(value)
      apply(value)
    }
    return () => { widget.callback = original }
  },
  onNodeConfigure: () => () => {},
}))

import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import { useBoundOptionKeys } from './useBoundOptionKeys'

describe('useBoundOptionKeys', () => {
  beforeEach(() => {
    loadWorkflowInfo.mockReset()
    comboOptionsVersion.value = 0
  })

  it('exposes only option keys marked true in uses_options', async () => {
    loadWorkflowInfo.mockResolvedValue({
      model: {
        'Rodin Gen25': {
          uses_options: { material: true, mode: true, seed: false, texture: true },
        },
      },
    })
    const node = {
      widgets: [{ name: 'workflow', value: 'Rodin Gen25' }],
    }
    const kind = ref('model')
    const { keys, isBound, refresh } = useBoundOptionKeys(() => node as any, kind)
    await refresh()
    await nextTick()
    expect([...keys.value].sort()).toEqual(['material', 'mode', 'texture'])
    expect(isBound('material')).toBe(true)
    expect(isBound('seed')).toBe(false)
  })

  it('clears keys when workflow label is empty', async () => {
    loadWorkflowInfo.mockResolvedValue({
      model: { X: { uses_options: { material: true } } },
    })
    const node = { widgets: [{ name: 'workflow', value: '' }] }
    const { keys, refresh } = useBoundOptionKeys(() => node as any, () => 'model')
    await refresh()
    expect(keys.value.size).toBe(0)
  })

  it('refreshes bound keys when the workflow widget callback fires', async () => {
    const node = {
      widgets: [{ name: 'workflow', value: 'A', callback: undefined as ((value: unknown) => void) | undefined }],
    }
    loadWorkflowInfo.mockImplementation(async () => ({
      image: {
        A: { uses_options: { old_option: true } },
        B: { uses_options: { new_option: true } },
      },
    }))
    const { keys } = useBoundOptionKeys(() => node as any, () => 'image')
    await vi.waitFor(() => expect([...keys.value]).toEqual(['old_option']))

    node.widgets[0].value = 'B'
    node.widgets[0].callback?.('B')
    await Promise.resolve()
    expect(keys.value).toEqual(new Set())
    await vi.waitFor(() => expect([...keys.value]).toEqual(['new_option']))

    node.widgets[0].value = 'A'
    node.widgets[0].callback?.('A')
    await Promise.resolve()
    expect(keys.value).toEqual(new Set())
    await vi.waitFor(() => expect([...keys.value]).toEqual(['old_option']))

    node.widgets[0].value = 'B'
    node.widgets[0].callback?.('B')
    await Promise.resolve()
    expect(keys.value).toEqual(new Set())
    await vi.waitFor(() => expect([...keys.value]).toEqual(['new_option']))
  })

  it('reads the new workflow after callbacks that run before widget assignment', async () => {
    const node = {
      widgets: [{ name: 'workflow', value: 'A', callback: undefined as ((value: unknown) => void) | undefined }],
    }
    loadWorkflowInfo.mockResolvedValue({
      image: {
        A: { uses_options: { old_option: true } },
        B: { uses_options: { new_option: true } },
      },
    })
    const { keys } = useBoundOptionKeys(() => node as any, () => 'image')
    await vi.waitFor(() => expect([...keys.value]).toEqual(['old_option']))

    node.widgets[0].callback?.('B')
    node.widgets[0].value = 'B'
    await Promise.resolve()
    expect(keys.value).toEqual(new Set())
    await vi.waitFor(() => expect([...keys.value]).toEqual(['new_option']))
  })
})
