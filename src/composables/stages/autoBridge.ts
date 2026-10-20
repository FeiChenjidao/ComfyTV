import { createNodeAt, findNamedSlot } from '@/composables/stages/spawnFollowUp'

export type BridgeSpec = {
  fromType: string
  toType: string
  nodeClass: string
  inSlotName: string
  outSlotIndex: number
}

export const BRIDGE_SPECS: BridgeSpec[] = [
  { fromType: 'STRING', toType: 'COMFYTV_TEXT', nodeClass: 'ComfyTV.BridgeToText', inSlotName: 'text', outSlotIndex: 0 },
  { fromType: 'IMAGE', toType: 'COMFYTV_IMAGE', nodeClass: 'ComfyTV.BridgeToImage', inSlotName: 'image', outSlotIndex: 0 },
  { fromType: 'IMAGE', toType: 'COMFYTV_IMAGES', nodeClass: 'ComfyTV.BridgeToImages', inSlotName: 'images', outSlotIndex: 0 },
  { fromType: 'VIDEO', toType: 'COMFYTV_VIDEO', nodeClass: 'ComfyTV.BridgeToVideo', inSlotName: 'video', outSlotIndex: 0 },
  { fromType: 'AUDIO', toType: 'COMFYTV_AUDIO', nodeClass: 'ComfyTV.BridgeToAudio', inSlotName: 'audio', outSlotIndex: 0 },
  { fromType: 'COMFYTV_TEXT', toType: 'STRING', nodeClass: 'ComfyTV.BridgeFromText', inSlotName: 'text', outSlotIndex: 0 },
  { fromType: 'COMFYTV_IMAGE', toType: 'IMAGE', nodeClass: 'ComfyTV.BridgeFromImage', inSlotName: 'image', outSlotIndex: 0 },
  { fromType: 'COMFYTV_IMAGE', toType: 'MASK', nodeClass: 'ComfyTV.BridgeFromMask', inSlotName: 'image', outSlotIndex: 0 },
  { fromType: 'COMFYTV_VIDEO', toType: 'VIDEO', nodeClass: 'ComfyTV.BridgeFromVideo', inSlotName: 'video', outSlotIndex: 0 },
  { fromType: 'COMFYTV_AUDIO', toType: 'AUDIO', nodeClass: 'ComfyTV.BridgeFromAudio', inSlotName: 'audio', outSlotIndex: 0 },
]

const BY_PAIR = new Map(BRIDGE_SPECS.map((s) => [`${s.fromType}|${s.toType}`, s]))

/** Default on — matches settings.py default. */
let enabled = true
let inserting = false

export function isAutoBridgeEnabled(): boolean {
  return enabled
}

export function applyAutoBridgeSetting(rows: Array<{ key: string; value: unknown }>): void {
  const row = rows.find((r) => r.key === 'auto-bridge')
  if (row) enabled = row.value !== false
}

export function typeParts(type: unknown): string[] {
  if (type == null || type === '' || type === '*' || type === 0) return []
  const s = String(type)
  if (!s.includes(',')) return [s]
  return s.split(',').map((p) => p.trim()).filter(Boolean)
}

export function lookupBridge(fromType: unknown, toType: unknown): BridgeSpec | null {
  for (const a of typeParts(fromType)) {
    for (const b of typeParts(toType)) {
      const hit = BY_PAIR.get(`${a}|${b}`)
      if (hit) return hit
    }
  }
  return null
}

export function isBridgeNode(node: unknown): boolean {
  const n = node as { comfyClass?: string; type?: string } | null
  const cls = String(n?.comfyClass || n?.type || '')
  return cls.startsWith('ComfyTV.Bridge')
}

function midPos(srcNode: any, dstNode: any): [number, number] {
  const sx = srcNode.pos?.[0] ?? 0
  const sy = srcNode.pos?.[1] ?? 0
  const sw = srcNode.size?.[0] ?? 280
  const dx = dstNode.pos?.[0] ?? sx + sw + 80
  const dy = dstNode.pos?.[1] ?? sy
  return [(sx + sw + dx) / 2 - 140, (sy + dy) / 2]
}

export function insertBridgeAndConnect(
  srcNode: any,
  output: any,
  dstNode: any,
  input: any,
  spec: BridgeSpec,
  afterReroute: unknown,
  origConnectSlots: (this: any, ...args: any[]) => any,
): any {
  const outIdx = srcNode.outputs?.indexOf(output) ?? -1
  const inIdx = dstNode.inputs?.indexOf(input) ?? -1
  if (outIdx < 0 || inIdx < 0) return null

  const bridge = createNodeAt(spec.nodeClass, midPos(srcNode, dstNode))
  if (!bridge) return null

  const bridgeInIdx = findNamedSlot(bridge, spec.inSlotName)
  const bridgeInSlot = bridgeInIdx >= 0 ? bridge.inputs?.[bridgeInIdx] : null
  const bridgeOutSlot = bridge.outputs?.[spec.outSlotIndex]
  if (!bridgeInSlot || !bridgeOutSlot) {
    console.warn(
      '[ComfyTV/auto-bridge] missing slots on', spec.nodeClass,
      'in=', spec.inSlotName, 'outIdx=', spec.outSlotIndex,
    )
    bridge.graph?.remove?.(bridge)
    return null
  }

  inserting = true
  try {
    const link1 = origConnectSlots.call(srcNode, output, bridge, bridgeInSlot, afterReroute)
    if (!link1) {
      bridge.graph?.remove?.(bridge)
      return null
    }
    const link2 = origConnectSlots.call(bridge, bridgeOutSlot, dstNode, input, undefined)
    return link2 ?? link1
  } finally {
    inserting = false
  }
}

function tryInstallPatches(): boolean {
  const LG = (window as any).LiteGraph
  if (!LG?.isValidConnection) return false
  const NodeProto = LG.LGraphNode?.prototype
  if (!NodeProto?.connectSlots) return false
  if (LG.__comfytvAutoBridgeInstalled) return true
  LG.__comfytvAutoBridgeInstalled = true

  const origIsValid = LG.isValidConnection.bind(LG)
  LG.isValidConnection = function (type_a: unknown, type_b: unknown) {
    if (origIsValid(type_a, type_b)) return true
    if (!isAutoBridgeEnabled()) return false
    return lookupBridge(type_a, type_b) != null
  }

  const origConnectSlots = NodeProto.connectSlots
  NodeProto.connectSlots = function (
    this: any,
    output: any,
    inputNode: any,
    input: any,
    afterReroute: any,
  ) {
    if (inserting || !isAutoBridgeEnabled()) {
      return origConnectSlots.call(this, output, inputNode, input, afterReroute)
    }
    if (isBridgeNode(this) || isBridgeNode(inputNode)) {
      return origConnectSlots.call(this, output, inputNode, input, afterReroute)
    }
    // Use native validity only — patched isValidConnection would wrongly allow a direct link.
    if (origIsValid(output?.type, input?.type)) {
      return origConnectSlots.call(this, output, inputNode, input, afterReroute)
    }
    const spec = lookupBridge(output?.type, input?.type)
    if (!spec) {
      this.setDirtyCanvas?.(false, true)
      return null
    }
    return insertBridgeAndConnect(
      this, output, inputNode, input, spec, afterReroute, origConnectSlots,
    )
  }
  return true
}

export function installAutoBridge(_app?: unknown): void {
  if (tryInstallPatches()) return
  let tries = 0
  const tick = () => {
    if (tryInstallPatches()) return
    if (++tries > 120) {
      console.warn('[ComfyTV/auto-bridge] LiteGraph.LGraphNode.connectSlots not available')
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
