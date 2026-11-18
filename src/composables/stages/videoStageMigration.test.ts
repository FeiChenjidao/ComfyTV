import { describe, expect, it } from 'vitest'

import {
  migrateVideoStageConfigureInfo,
  normalizeVideoStageWidgets,
} from './videoStageMigration'

function makeNode() {
  return {
    widgets: [
      { name: 'workflow', value: '' },
      { name: 'resolution', value: '720P' },
      { name: 'aspect_ratio', value: '16:9' },
      { name: 'duration_s', value: 5 },
      { name: 'generate_audio', value: false },
      { name: 'main_prompt', value: '' },
      { name: 'custom_params', value: '{}' },
      { name: 'mode', value: '文生视频' },
      { name: 'batch_size', value: 1 },
    ],
  } as any
}

describe('migrateVideoStageConfigureInfo', () => {
  it('keeps pre-mode workflows aligned and normalizes aliases', () => {
    const node = makeNode()
    const info = {
      widgets_values: [
        'Ignis Seedance 2.5', '720p', 'adaptive', 5, false, 'prompt', '{}',
      ],
    }

    expect(migrateVideoStageConfigureInfo(node, info)).toBe(true)
    expect(info.widgets_values).toEqual([
      'Ignis Seedance 2.5', '720P', 'auto', 5, false, 'prompt', '{}',
    ])
  })

  it('moves the interim mode widget to the appended position', () => {
    const node = makeNode()
    const info = {
      widgets_values: [
        'Ignis Seedance 2.5', '图生视频', '1080P', '16:9', 8, false,
        'prompt', '{}',
      ],
    }

    expect(migrateVideoStageConfigureInfo(node, info)).toBe(true)
    expect(info.widgets_values).toEqual([
      'Ignis Seedance 2.5', '1080P', '16:9', 8, false, 'prompt', '{}',
      '图生视频',
    ])
  })

  it('recovers a pre-mode node that was saved after positional corruption', () => {
    const node = makeNode()
    const info = {
      widgets_values: [
        'Ignis Seedance 2.5', '文生视频', '720P', '16:9', 0,
        'original prompt', '{"items":[{"key":"x","value":1}]}', '{}',
      ],
    }

    expect(migrateVideoStageConfigureInfo(node, info)).toBe(true)
    expect(info.widgets_values).toEqual([
      'Ignis Seedance 2.5', '720P', '16:9', 5, false, 'original prompt',
      '{"items":[{"key":"x","value":1}]}', '文生视频',
    ])
  })
})

describe('normalizeVideoStageWidgets', () => {
  it('repairs invalid live widget values before queueing', () => {
    const node = makeNode()
    node.widgets.find((widget: any) => widget.name === 'resolution').value = '1080p'
    node.widgets.find((widget: any) => widget.name === 'aspect_ratio').value = 'adaptive'
    node.widgets.find((widget: any) => widget.name === 'duration_s').value = 0
    node.widgets.find((widget: any) => widget.name === 'generate_audio').value = 'prompt'
    node.widgets.find((widget: any) => widget.name === 'mode').value = '720P'
    node.widgets.find((widget: any) => widget.name === 'batch_size').value = 99

    normalizeVideoStageWidgets(node)

    expect(node.widgets.map((widget: any) => widget.value)).toEqual([
      '', '1080P', 'auto', 5, false, '', '{}', '文生视频', 8,
    ])
  })
})
