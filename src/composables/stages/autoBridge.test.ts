import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createNodeAt, findNamedSlot } = vi.hoisted(() => ({
  createNodeAt: vi.fn(),
  findNamedSlot: vi.fn(),
}))

vi.mock('@/composables/stages/spawnFollowUp', () => ({
  createNodeAt,
  findNamedSlot,
}))

import {
  applyAutoBridgeSetting,
  BRIDGE_SPECS,
  insertBridgeAndConnect,
  isAutoBridgeEnabled,
  isBridgeNode,
  lookupBridge,
  typeParts,
} from '@/composables/stages/autoBridge'

describe('autoBridge setting', () => {
  it('defaults on and follows the auto-bridge row', () => {
    applyAutoBridgeSetting([{ key: 'auto-bridge', value: true }])
    expect(isAutoBridgeEnabled()).toBe(true)
    applyAutoBridgeSetting([{ key: 'enable-v2', value: false }])
    expect(isAutoBridgeEnabled()).toBe(true)
    applyAutoBridgeSetting([{ key: 'auto-bridge', value: false }])
    expect(isAutoBridgeEnabled()).toBe(false)
    applyAutoBridgeSetting([{ key: 'auto-bridge', value: true }])
    expect(isAutoBridgeEnabled()).toBe(true)
  })
})

describe('lookupBridge', () => {
  it('covers all ten bridge pairs', () => {
    expect(BRIDGE_SPECS).toHaveLength(10)
    for (const spec of BRIDGE_SPECS) {
      expect(lookupBridge(spec.fromType, spec.toType)).toEqual(spec)
    }
  })

  it('picks by target type for ambiguous IMAGE / COMFYTV_IMAGE sources', () => {
    expect(lookupBridge('IMAGE', 'COMFYTV_IMAGE')?.nodeClass).toBe('ComfyTV.BridgeToImage')
    expect(lookupBridge('IMAGE', 'COMFYTV_IMAGES')?.nodeClass).toBe('ComfyTV.BridgeToImages')
    expect(lookupBridge('COMFYTV_IMAGE', 'IMAGE')?.nodeClass).toBe('ComfyTV.BridgeFromImage')
    expect(lookupBridge('COMFYTV_IMAGE', 'MASK')?.nodeClass).toBe('ComfyTV.BridgeFromMask')
  })

  it('resolves comma-union slot types', () => {
    expect(lookupBridge('IMAGE,MASK', 'COMFYTV_IMAGE')?.nodeClass).toBe('ComfyTV.BridgeToImage')
    expect(lookupBridge('COMFYTV_IMAGE', 'IMAGE,LATENT')?.nodeClass).toBe('ComfyTV.BridgeFromImage')
  })

  it('returns null for unbridged or wildcard types', () => {
    expect(lookupBridge('MASK', 'COMFYTV_IMAGE')).toBeNull()
    expect(lookupBridge('COMFYTV_IMAGES', 'IMAGE')).toBeNull()
    expect(lookupBridge('*', 'COMFYTV_IMAGE')).toBeNull()
    expect(lookupBridge('IMAGE', '*')).toBeNull()
    expect(lookupBridge('LATENT', 'IMAGE')).toBeNull()
  })
})

describe('typeParts', () => {
  it('splits and ignores wildcards', () => {
    expect(typeParts('IMAGE')).toEqual(['IMAGE'])
    expect(typeParts('IMAGE, MASK')).toEqual(['IMAGE', 'MASK'])
    expect(typeParts('*')).toEqual([])
    expect(typeParts('')).toEqual([])
    expect(typeParts(0)).toEqual([])
  })
})

describe('isBridgeNode', () => {
  it('detects ComfyTV.Bridge* classes', () => {
    expect(isBridgeNode({ comfyClass: 'ComfyTV.BridgeToImage' })).toBe(true)
    expect(isBridgeNode({ type: 'ComfyTV.BridgeFromMask' })).toBe(true)
    expect(isBridgeNode({ comfyClass: 'ComfyTV.ImageStage' })).toBe(false)
    expect(isBridgeNode(null)).toBe(false)
  })
})

describe('insertBridgeAndConnect', () => {
  beforeEach(() => {
    createNodeAt.mockReset()
    findNamedSlot.mockReset()
  })

  it('creates a bridge and wires both hops', () => {
    const bridgeIn = { name: 'image', type: 'IMAGE' }
    const bridgeOut = { name: 'image', type: 'COMFYTV_IMAGE' }
    const bridge = {
      inputs: [bridgeIn],
      outputs: [bridgeOut],
      graph: { remove: vi.fn() },
    }
    createNodeAt.mockReturnValue(bridge)
    findNamedSlot.mockReturnValue(0)

    const output = { type: 'IMAGE' }
    const input = { type: 'COMFYTV_IMAGE' }
    const src = { outputs: [output], pos: [0, 0], size: [280, 200] }
    const dst = { inputs: [input], pos: [600, 0], size: [280, 200] }
    const link1 = { id: 1 }
    const link2 = { id: 2 }
    const orig = vi.fn()
      .mockReturnValueOnce(link1)
      .mockReturnValueOnce(link2)

    const spec = lookupBridge('IMAGE', 'COMFYTV_IMAGE')!
    const result = insertBridgeAndConnect(src, output, dst, input, spec, 9, orig)

    expect(createNodeAt).toHaveBeenCalledWith('ComfyTV.BridgeToImage', expect.any(Array))
    expect(orig).toHaveBeenCalledTimes(2)
    expect(orig.mock.calls[0][0]).toBe(output)
    expect(orig.mock.calls[0][1]).toBe(bridge)
    expect(orig.mock.calls[0][2]).toBe(bridgeIn)
    expect(orig.mock.calls[0][3]).toBe(9)
    expect(orig.mock.calls[1][0]).toBe(bridgeOut)
    expect(orig.mock.calls[1][1]).toBe(dst)
    expect(orig.mock.calls[1][2]).toBe(input)
    expect(result).toBe(link2)
    expect(bridge.graph.remove).not.toHaveBeenCalled()
  })

  it('removes the bridge if the first hop fails', () => {
    const bridgeIn = { name: 'image', type: 'IMAGE' }
    const bridgeOut = { name: 'image', type: 'COMFYTV_IMAGE' }
    const bridge = {
      inputs: [bridgeIn],
      outputs: [bridgeOut],
      graph: { remove: vi.fn() },
    }
    createNodeAt.mockReturnValue(bridge)
    findNamedSlot.mockReturnValue(0)

    const output = { type: 'IMAGE' }
    const input = { type: 'COMFYTV_IMAGE' }
    const src = { outputs: [output], pos: [0, 0], size: [280, 200] }
    const dst = { inputs: [input], pos: [600, 0], size: [280, 200] }
    const orig = vi.fn().mockReturnValue(null)

    const spec = lookupBridge('IMAGE', 'COMFYTV_IMAGE')!
    expect(insertBridgeAndConnect(src, output, dst, input, spec, undefined, orig)).toBeNull()
    expect(bridge.graph.remove).toHaveBeenCalledWith(bridge)
    expect(orig).toHaveBeenCalledTimes(1)
  })
})
