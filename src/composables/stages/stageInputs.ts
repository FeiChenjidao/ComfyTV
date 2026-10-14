import type { ResolvedInput } from '@/stores/stageStore'
import { computePickedFromBatch, toImagePoolJson } from '@/stores/stageStore'

export function pickSourceImageUrl(inputs: ResolvedInput[], slot = 'image'): string | null {
  const inp = inputs.find(i => i.slot === slot)
  if (!inp || inp.source !== 'upstream' || !inp.content) return null
  return inp.content
}

/** Plain COMFYTV_IMAGE URL or COMFYTV_IMAGES batch JSON → a single view URL. */
export function coerceImageUrl(content: string | null | undefined): string | null {
  if (!content) return null
  const s = String(content).trim()
  if (!s) return null
  return computePickedFromBatch(toImagePoolJson(s), 1)
}

/** Compare A/B: link presence vs resolved preview URL. */
export function resolveCompareSlot(
  inputs: ResolvedInput[],
  slot: string,
): { wired: boolean; url: string | null } {
  const inp = inputs.find(i => i.slot === slot)
  if (!inp || inp.source === 'empty') return { wired: false, url: null }
  const wired = inp.source === 'upstream' || inp.source === 'upstream-pending'
  const url = inp.source === 'upstream' ? coerceImageUrl(inp.content) : null
  return { wired, url }
}
