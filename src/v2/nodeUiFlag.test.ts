import { describe, expect, it } from 'vitest'

import { useNodeUiFlag } from '@/v2/nodeUiFlag'

const node = (properties: Record<string, unknown> = {}) => ({ properties }) as any

describe('useNodeUiFlag', () => {
  it('falls back until the node says otherwise', () => {
    const flag = useNodeUiFlag(() => node(), 'v2_params_open')
    expect(flag.value).toBe(false)
    expect(useNodeUiFlag(() => node({ v2_params_open: true }), 'v2_params_open').value).toBe(true)
  })

  it('writes to properties, so a paste keeps section and height in step', () => {
    const source = node()
    const flag = useNodeUiFlag(() => source, 'v2_params_open')
    flag.value = true
    expect(source.properties.v2_params_open).toBe(true)
    expect(flag.value).toBe(true)

    const pasted = node({ ...source.properties })
    expect(useNodeUiFlag(() => pasted, 'v2_params_open').value).toBe(true)
  })
})
