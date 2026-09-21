import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiSend = vi.fn(async () => ({ ok: true }))
vi.mock('@/api', () => ({
  fetchWorkflowConfig: vi.fn(),
  apiSend: (...a: unknown[]) => apiSend(...a),
  OkSchema: {},
}))
vi.mock('@/composables/stages/useWorkflowPrep', () => ({
  prepareWorkflow: vi.fn(async () => {}),
}))
vi.mock('@/composables/stages/workflowCombo', () => ({
  comboOptionsVersion: { value: 0 },
}))

import { fetchWorkflowConfig } from '@/api'
import { comboOptionsVersion } from '@/composables/stages/workflowCombo'
import { ASPECT_RATIOS_DEFAULT, RESOLUTIONS } from '@/utils/sizing'
import {
  clearBoundOptionEnumsCache,
  enumsFromExposedWidgets,
  loadBoundOptionEnums,
  syncBoundOptionEnums,
} from './boundOptionEnums'

describe('enumsFromExposedWidgets', () => {
  it('prefers option:* bindings over name matches', () => {
    const enums = enumsFromExposedWidgets([
      {
        widget_name: 'model.aspect_ratio',
        stage_binding: 'option:aspect_ratio',
        widget_type: 'COMBO',
        widget_props: { values: ['auto', '1:1'] },
      },
      {
        widget_name: 'other.aspect_ratio',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['21:9'] },
      },
      {
        widget_name: 'model.resolution',
        stage_binding: 'option:resolution',
        widget_type: 'COMBO',
        widget_props: { values: ['1K', '2K', '4K'] },
      },
    ])
    expect(enums).toEqual({
      aspect_ratio: ['auto', '1:1'],
      resolution: ['1K', '2K', '4K'],
    })
  })

  it('falls back to leaf widget names when unbound (Nano Banana model.*)', () => {
    const enums = enumsFromExposedWidgets([
      {
        widget_name: 'model.aspect_ratio',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['auto', '1:4', '16:9'] },
      },
      {
        widget_name: 'model.resolution',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['1K', '2K'] },
      },
    ])
    expect(enums.aspect_ratio).toEqual(['auto', '1:4', '16:9'])
    expect(enums.resolution).toEqual(['1K', '2K'])
  })

  it('picks Tripo / Rodin Gen-2.5 COMBO leaves for Model3D Stage', () => {
    const enums = enumsFromExposedWidgets([
      {
        widget_name: 'texture_quality',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['standard', 'detailed', 'extreme'] },
      },
      {
        widget_name: 'Material_Type',
        stage_binding: 'option:material',
        widget_type: 'COMBO',
        widget_props: { values: ['PBR', 'Shaded'] },
      },
      {
        widget_name: 'mode',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['Regular', 'Fast', 'Extreme-High'] },
      },
      {
        widget_name: 'mode.polygon_count',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['Default', '18K-Quad', '1M-Triangle'] },
      },
    ])
    expect(enums.texture_quality).toEqual(['standard', 'detailed', 'extreme'])
    expect(enums.material).toEqual(['PBR', 'Shaded'])
    expect(enums.mode).toEqual(['Regular', 'Fast', 'Extreme-High'])
    expect(enums.polygon_count).toEqual(['Default', '18K-Quad', '1M-Triangle'])
  })

  it('includes any bound option:* COMBO, not only the whitelist', () => {
    const enums = enumsFromExposedWidgets([
      {
        widget_name: 'foo.custom_quality',
        stage_binding: 'option:custom_quality',
        widget_type: 'COMBO',
        widget_props: { values: ['low', 'high'] },
      },
    ])
    expect(enums.custom_quality).toEqual(['low', 'high'])
  })

  it('maps aliased leaves (target_resolution / scale_factor) onto Stage scale', () => {
    const enums = enumsFromExposedWidgets(
      [{
        widget_name: 'target_resolution',
        stage_binding: null,
        widget_type: 'COMBO',
        widget_props: { values: ['2K', '4K', '8K'] },
      }],
      ['scale'],
    )
    expect(enums.scale).toEqual(['2K', '4K', '8K'])
  })
})

describe('syncBoundOptionEnums', () => {
  beforeEach(() => {
    clearBoundOptionEnumsCache()
    comboOptionsVersion.value = 0
    vi.mocked(fetchWorkflowConfig).mockReset()
    apiSend.mockClear()
  })

  it('patches Stage combo lists from unbound model.* widgets and auto-binds', async () => {
    vi.mocked(fetchWorkflowConfig)
      .mockResolvedValueOnce({
        id: 9,
        exposed_widgets: [
          {
            node_id: '1',
            widget_name: 'model.aspect_ratio',
            stage_binding: null,
            widget_type: 'COMBO',
            widget_props: { values: ['auto', '16:9'] },
          },
          {
            node_id: '1',
            widget_name: 'model.resolution',
            stage_binding: null,
            widget_type: 'COMBO',
            widget_props: { values: ['1K', '2K'] },
          },
        ],
      } as any)
      .mockResolvedValueOnce({
        id: 9,
        exposed_widgets: [
          {
            node_id: '1',
            widget_name: 'model.aspect_ratio',
            stage_binding: 'option:aspect_ratio',
            widget_type: 'COMBO',
            widget_props: { values: ['auto', '16:9'] },
          },
          {
            node_id: '1',
            widget_name: 'model.resolution',
            stage_binding: 'option:resolution',
            widget_type: 'COMBO',
            widget_props: { values: ['1K', '2K'] },
          },
        ],
      } as any)

    const node: any = {
      widgets: [
        { name: 'aspect_ratio', type: 'combo', value: '1:1', options: { values: [...ASPECT_RATIOS_DEFAULT] }, callback: vi.fn() },
        { name: 'resolution', type: 'combo', value: '1080P', options: { values: [...RESOLUTIONS] }, callback: vi.fn() },
      ],
    }

    await syncBoundOptionEnums(node, 'image', 'NanoBanana2')
    expect(apiSend).toHaveBeenCalled()
    expect(node.widgets[0].options.values).toEqual(['auto', '16:9'])
    expect(node.widgets[0].value).toBe('auto')
    expect(node.widgets[1].options.values).toEqual(['1K', '2K'])
    expect(node.widgets[1].value).toBe('1K')
    expect(comboOptionsVersion.value).toBe(1)
  })

  it('leaves Stage combo lists alone when the workflow has no matching COMBOs', async () => {
    vi.mocked(fetchWorkflowConfig).mockResolvedValueOnce({
      id: 1,
      exposed_widgets: [],
    } as any)

    const node: any = {
      widgets: [
        { name: 'aspect_ratio', type: 'combo', value: 'auto', options: { values: ['auto', '1:1'] }, callback: vi.fn() },
        { name: 'resolution', type: 'combo', value: '2K', options: { values: ['1K', '2K'] }, callback: vi.fn() },
      ],
    }

    await syncBoundOptionEnums(node, 'image', 'Local SD')
    expect(node.widgets[0].options.values).toEqual(['auto', '1:1'])
    expect(node.widgets[1].options.values).toEqual(['1K', '2K'])
  })

  it('syncs Stage scale from bound target_resolution (2K/4K/8K)', async () => {
    vi.mocked(fetchWorkflowConfig).mockResolvedValue({
      id: 3,
      exposed_widgets: [{
        node_id: '18',
        widget_name: 'target_resolution',
        stage_binding: 'option:scale',
        widget_type: 'COMBO',
        widget_props: { values: ['2K', '4K', '8K'] },
      }],
    } as any)

    const node: any = {
      widgets: [
        { name: 'scale', type: 'combo', value: '2x', options: { values: ['2x', '4x'] }, callback: vi.fn() },
      ],
    }

    await syncBoundOptionEnums(node, 'upscale', 'WaveSpeed')
    expect(node.widgets[0].options.values).toEqual(['2K', '4K', '8K'])
    expect(node.widgets[0].value).toBe('2K')
  })

  it('caches per kind/label until cleared', async () => {
    vi.mocked(fetchWorkflowConfig).mockResolvedValue({
      id: 1,
      exposed_widgets: [{
        node_id: '1',
        widget_name: 'model.resolution',
        stage_binding: 'option:resolution',
        widget_type: 'COMBO',
        widget_props: { values: ['1K'] },
      }],
    } as any)

    await loadBoundOptionEnums('image', 'A')
    await loadBoundOptionEnums('image', 'A')
    expect(fetchWorkflowConfig).toHaveBeenCalledTimes(1)
    clearBoundOptionEnumsCache('image', 'A')
    await loadBoundOptionEnums('image', 'A')
    expect(fetchWorkflowConfig).toHaveBeenCalledTimes(2)
  })
})
