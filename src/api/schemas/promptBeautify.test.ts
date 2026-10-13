import { describe, expect, it } from 'vitest'

import { PromptBeautifyResultSchema } from './promptBeautify'

describe('PromptBeautifyResultSchema', () => {
  it('accepts a successful beautify payload', () => {
    const parsed = PromptBeautifyResultSchema.parse({
      prompt: 'a red apple on a wooden table, soft light',
      provider: 'local-llm',
      model: 'qwen3',
    })
    expect(parsed.provider).toBe('local-llm')
  })

  it('rejects missing prompt', () => {
    expect(() => PromptBeautifyResultSchema.parse({
      provider: 'comfyui-llm',
      model: 'x',
    })).toThrow()
  })
})
