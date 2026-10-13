import type { Asset } from '@/api/schemas'
import { app } from '@/lib/comfyApp'
import { findFreePos } from '@/composables/stages/placeFree'

const LOADER_CLASS_BY_MEDIA: Record<string, string> = {
  image: 'ComfyTV.AssetImageLoaderStage',
  video: 'ComfyTV.AssetVideoLoaderStage',
  audio: 'ComfyTV.AssetAudioLoaderStage',
  model: 'ComfyTV.AssetModelLoaderStage',
  text: 'ComfyTV.AssetTextLoaderStage',
}

export function assetLoaderClass(mediaType: string): string | null {
  return LOADER_CLASS_BY_MEDIA[mediaType] ?? null
}

function setWidget(node: any, name: string, value: any) {
  const w = node.widgets?.find((wi: any) => wi.name === name)
  if (w) w.value = value
}

export function canvasCenter(): [number, number] {
  try {
    const canvas = (app as any)?.canvas
    const ds = canvas?.ds
    const el = canvas?.canvas
    const rect = el?.getBoundingClientRect?.()
    const w = rect?.width || el?.clientWidth || el?.width || 1000
    const h = rect?.height || el?.clientHeight || el?.height || 700
    if (ds?.convertCanvasToOffset) {
      const out = ds.convertCanvasToOffset([w / 2, h / 2], [0, 0])
      if (Array.isArray(out)) return [out[0], out[1]]
    }
    const scale = ds?.scale || 1
    const off = ds?.offset
    if (off) return [w / 2 / scale - off[0], h / 2 / scale - off[1]]
  } catch (e) {
    console.warn('[ComfyTV/asset-loader] canvasCenter failed', e)
  }
  return [0, 0]
}

export function clientToCanvasPos(clientX: number, clientY: number): [number, number] {
  try {
    const canvas = (app as any)?.canvas
    const ds = canvas?.ds
    const el = canvas?.canvas
    const rect = el?.getBoundingClientRect?.()
    const x = clientX - (rect?.left ?? 0)
    const y = clientY - (rect?.top ?? 0)
    if (ds?.convertCanvasToOffset) {
      const out = ds.convertCanvasToOffset([x, y], [0, 0])
      if (Array.isArray(out)) return [out[0], out[1]]
    }
    const scale = ds?.scale || 1
    const off = ds?.offset
    if (off) return [x / scale - off[0], y / scale - off[1]]
    return [x, y]
  } catch (e) {
    console.warn('[ComfyTV/asset-loader] clientToCanvasPos failed', e)
    return [0, 0]
  }
}

export interface SpawnAssetLoaderOpts {
  anchor?: 'topleft' | 'center'
  select?: boolean
}

/**
 * Select a graph node with Comfy's current canvas APIs and focus the canvas so
 * Delete/Backspace work immediately after programmatic spawn (asset drag/click).
 *
 * Legacy `selectNode` alone can leave `node.selected` true while `selectedItems`
 * stays empty — Delete then no-ops until the user re-clicks via processSelect.
 */
export function selectOnCanvas(node: any): void {
  if (!node) return
  const apply = () => {
    const canvas = (app as any)?.canvas
    if (!canvas) return
    try {
      const ae = document.activeElement
      const canvasEl = canvas.canvas as HTMLElement | undefined
      if (ae instanceof HTMLElement && ae !== canvasEl && ae !== document.body) {
        ae.blur()
      }
      if (typeof canvas.deselectAll === 'function') canvas.deselectAll()
      else canvas.deselectAllNodes?.()

      if (typeof canvas.selectNodes === 'function') canvas.selectNodes([node])
      else if (typeof canvas.select === 'function') canvas.select(node)
      else canvas.selectNode?.(node)

      if (canvasEl) {
        if (!canvasEl.hasAttribute('tabindex')) canvasEl.tabIndex = -1
        canvasEl.focus?.({ preventScroll: true })
      }
      ;(app as any)?.graph?.setDirtyCanvas?.(true, true)
    } catch (e) {
      console.warn('[ComfyTV/asset-loader] selectOnCanvas failed', e)
    }
  }
  // Defer past HTML5 dragend + Vue shell mount so selection/focus stick.
  requestAnimationFrame(() => {
    apply()
    requestAnimationFrame(apply)
  })
}

export function createAssetLoaderNode(
  asset: Asset,
  pos: [number, number],
  opts: SpawnAssetLoaderOpts = {},
): any | null {
  const win = window as any
  if (!win.LiteGraph?.createNode) {
    console.error('[ComfyTV/asset-loader] LiteGraph.createNode not available')
    return null
  }
  const loaderClass = assetLoaderClass(asset.media_type)
  if (!loaderClass) return null
  const node = win.LiteGraph.createNode(loaderClass)
  if (!node) {
    console.error('[ComfyTV/asset-loader] createNode returned null for', asset.media_type)
    return null
  }
  const graph = (app as any)?.graph
  graph?.add(node)

  const sw = node.size?.[0] || 280
  const sh = node.size?.[1] || 200
  if (opts.anchor === 'center') {
    node.pos = [pos[0] - sw / 2, pos[1] - sh / 2]
  } else {
    node.pos = findFreePos(graph, pos, [sw, sh], node)
  }

  const category = asset.category_ids.length > 0 ? String(asset.category_ids[0]) : 'none'
  setWidget(node, 'category', category)
  setWidget(node, 'asset_url', asset.payload_url)
  setWidget(node, 'asset_id', asset.id)

  if (opts.select) selectOnCanvas(node)
  else ;(app as any)?.graph?.setDirtyCanvas?.(true, true)

  return node
}
