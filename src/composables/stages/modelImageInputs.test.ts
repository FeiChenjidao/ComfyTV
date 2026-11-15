import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchWorkflowConfig = vi.fn()
vi.mock('@/api', () => ({
  fetchWorkflowConfig: (...args: unknown[]) => fetchWorkflowConfig(...args),
}))

let bindingsVersion = 0
vi.mock('@/stores/selectionStore', () => ({
  useSelectionStore: () => ({ bindingsVersion }),
}))

import {
  applyModelImageInputProfile,
  fetchModelImageInputProfileCached,
  modelImageInputLabel,
  modelImageInputProfileFromConfig,
} from './modelImageInputs'

const translate = (key: string, params?: Record<string, unknown>) => {
  const labels: Record<string, string> = {
    'stage.modelInput.front': '正',
    'stage.modelInput.left': '左',
    'stage.modelInput.back': '背',
    'stage.modelInput.right': '右',
    'stage.modelInput.extra': '辅',
  }
  if (key === 'stage.modelInput.reference') return `参考图 ${params?.n}`
  if (key === 'stage.modelInput.image') return `图片 ${params?.n}`
  return labels[key] ?? key
}

function binding(slot: number) {
  return {
    node_id: String(slot + 10),
    node_title: `image${slot}`,
    node_type: 'LoadImage',
    group_title: null,
    widget_name: 'image',
    widget_type: 'COMBO',
    widget_props: {},
    current_value: '',
    stage_binding: `upstream_image:annotated[${slot}]`,
    override_value: null,
    cast: null,
  }
}

beforeEach(() => {
  fetchWorkflowConfig.mockReset()
  bindingsVersion = 0
})

describe('modelImageInputProfileFromConfig', () => {
  it('keeps workflow-declared role order and actual bound slots', () => {
    const profile = modelImageInputProfileFromConfig({
      meta: { model_image_slots: ['front', 'left', 'back', 'right'] },
      exposed_widgets: [binding(3), binding(0), binding(2)],
    } as any)
    expect(profile).toEqual({
      roles: ['front', 'left', 'back', 'right'],
      boundSlots: [0, 2, 3],
    })
  })
})

describe('modelImageInputLabel', () => {
  it('translates known roles and numbers generic references', () => {
    expect(modelImageInputLabel('front', 0, translate)).toBe('正')
    expect(modelImageInputLabel('reference', 4, translate)).toBe('参考图 5')
    expect(modelImageInputLabel(undefined, 2, translate)).toBe('图片 3')
    expect(modelImageInputLabel('custom view', 1, translate)).toBe('custom view')
  })
})

describe('applyModelImageInputProfile', () => {
  it('labels by semantic order and hides only unused unlinked sockets', () => {
    const inputs: Array<{
      name: string
      link: number | null
      label?: string
      hidden?: boolean
      localized_name?: string
    }> = [
      { name: 'images.image0', link: null },
      { name: 'images.image1', link: null },
      { name: 'images.image2', link: 12 },
      { name: 'images.image3', link: null },
      { name: 'main_prompt', link: null },
    ]
    const node = {
      inputs,
      setDirtyCanvas: vi.fn(),
    }
    applyModelImageInputProfile(node, {
      roles: ['front', 'left', 'back', 'right'],
      boundSlots: [0, 1],
    }, translate)
    expect(node.inputs.slice(0, 4).map(input => input.label)).toEqual(['正', '左', '背', '右'])
    expect(node.inputs.slice(0, 4).map(input => input.hidden)).toEqual([false, false, false, true])
    expect(node.inputs[4]).not.toHaveProperty('label')
    expect(node.setDirtyCanvas).toHaveBeenCalled()
  })
})

describe('fetchModelImageInputProfileCached', () => {
  it('deduplicates by workflow and invalidates after binding changes', async () => {
    fetchWorkflowConfig.mockResolvedValue({
      meta: { model_image_slots: ['reference'] },
      exposed_widgets: [binding(0)],
    })
    const first = fetchModelImageInputProfileCached('model', 'Rodin')
    const second = fetchModelImageInputProfileCached('model', 'Rodin')
    expect(first).toBe(second)
    await first
    bindingsVersion = 1
    await fetchModelImageInputProfileCached('model', 'Rodin')
    expect(fetchWorkflowConfig).toHaveBeenCalledTimes(2)
  })
})
