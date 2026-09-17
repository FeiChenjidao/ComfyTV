import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const loadWorkflowInfo = vi.fn(async () => ({} as Record<string, unknown>))
vi.mock('@/composables/stages/useWorkflowValidator', () => ({
  loadWorkflowInfo: (...a: unknown[]) => loadWorkflowInfo(...a),
}))
vi.mock('@/composables/stages/workflowCombo', () => ({
  comboOptionsVersion: { value: 0 },
}))
vi.mock('@/utils/widget', () => ({
  getWidget: (node: any, name: string) =>
    node?.widgets?.find((w: any) => w.name === name),
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
})
