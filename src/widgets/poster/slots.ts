import { isMediaSocketName, liveLinks } from '@/composables/stages/mediaOrder'

export interface SlotEl { slot?: number; bind?: string }
export interface SlotOverride { slot?: number }
export interface NodeInput { name?: string; link?: number | null }

export function defaultSlot(el: SlotEl): number {
  if (Number.isInteger(el.slot)) return el.slot as number
  const m = /image:(\d+)/.exec(el.bind || '')
  return m ? parseInt(m[1]!, 10) : 0
}

export function curSlot(el: SlotEl, override?: SlotOverride | null): number {
  const o = override || {}
  return Number.isInteger(o.slot) ? (o.slot as number) : defaultSlot(el)
}

/** Wired image sockets on the node (autogrow + plain image / image_a|b). */
export function connectedImageCount(inputs: NodeInput[]): number {
  const node = { inputs }
  if (!inputs?.some(i => typeof i?.name === 'string' && isMediaSocketName(i.name, 'image'))) {
    return 0
  }
  const links = liveLinks(node, 'image')
  if (links.length === 0) return 0
  return Math.max(...links.map(l => l.slot)) + 1
}
