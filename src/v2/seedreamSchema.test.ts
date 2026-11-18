import { describe, expect, it } from 'vitest'

import { parseSeedreamModels } from '@/v2/seedreamSchema'

describe('parseSeedreamModels', () => {
  it('keeps model-specific presets and optional background controls', () => {
    const models = parseSeedreamModels({
      ByteDanceSeedreamNodeV3: {
        input: {
          required: {
            model: ['COMFY_DYNAMICCOMBO_V3', {
              options: [
                {
                  key: 'seedream 5.5',
                  inputs: { required: {
                    size_preset: ['COMBO', { options: ['(2K) 2048x2048 (1:1)', 'Custom'], default: '(2K) 2048x2048 (1:1)' }],
                    width: ['INT', { default: 2048, min: 240, max: 8594, step: 2 }],
                    height: ['INT', { default: 2048, min: 240, max: 8594, step: 2 }],
                    background: ['COMBO', { options: ['auto', 'transparent'], default: 'auto' }],
                    seed: ['INT', { default: 42, min: 0, max: 2147483647, step: 1 }],
                  } },
                },
                {
                  key: 'seedream 5.0 pro',
                  inputs: { required: {
                    size_preset: ['COMBO', { options: ['(1K) 1024x1024 (1:1)', 'Custom'], default: '(1K) 1024x1024 (1:1)' }],
                    width: ['INT', { default: 2048, min: 1024, max: 4514, step: 2 }],
                    height: ['INT', { default: 2048, min: 1024, max: 4514, step: 2 }],
                    seed: ['INT', { default: 42, min: 0, max: 2147483647, step: 1 }],
                  } },
                },
              ],
            }],
          },
        },
      },
    })

    expect(models.map(model => model.key)).toEqual(['seedream 5.5', 'seedream 5.0 pro'])
    expect(models[0].sizeOptions).toEqual(['(2K) 2048x2048 (1:1)', 'Custom'])
    expect(models[0].backgroundOptions).toEqual(['auto', 'transparent'])
    expect(models[1].backgroundOptions).toEqual([])
    expect(models[1].width.min).toBe(1024)
  })
})
