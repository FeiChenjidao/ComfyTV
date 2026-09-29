import { app } from '@/lib/comfyApp'
import { findFreePos } from '@/composables/stages/placeFree'
import { getWidget, writeWidget } from '@/utils/widget'


export const PHOTOSHOP_LAYER_EVENT = 'comfytv-photoshop-layer'
export const IMAGE_LOADER_CLASS = 'ComfyTV.ImageLoaderStage'

export interface PhotoshopLayerPayload {
  name: string
  subfolder: string
  type: 'input'
  url: string
  document: string
  layer: string
  width: number
  height: number
}

function selectedNodes(canvas: any): any[] {
  const selected = canvas?.selected_nodes
  if (!selected) return []
  if (typeof selected[Symbol.iterator] === 'function') return Array.from(selected)
  return Object.values(selected)
}

function isImageLoader(node: any): boolean {
  return String(node?.comfyClass ?? '') === IMAGE_LOADER_CLASS
}

function selectedTarget(host: any): any | null {
  const selected = selectedNodes(host?.canvas)
  if (selected.length === 1 && isImageLoader(selected[0])) return selected[0]
  return null
}

function createTarget(host: any): any | null {
  const node = (window as any).LiteGraph?.createNode?.(IMAGE_LOADER_CLASS)
  if (!node) return null
  host?.graph?.add?.(node)
  const cursor = host?.canvas?.graph_mouse
  const origin: [number, number] = Array.isArray(cursor) && cursor.length >= 2
    ? [Number(cursor[0]) || 0, Number(cursor[1]) || 0]
    : [40, 40]
  node.pos = findFreePos(
    host?.graph,
    origin,
    [Number(node.size?.[0]) || 280, Number(node.size?.[1]) || 340],
    node,
  )
  return node
}

export function applyPhotoshopLayer(host: any, payload: PhotoshopLayerPayload): any | null {
  if (!payload?.name || !payload?.subfolder || payload.type !== 'input') return null
  const selected = selectedTarget(host)
  const node = selected ?? createTarget(host)
  if (!node) return null

  node.properties ??= {}
  node.properties.comfytv_photoshop_document = payload.document
  node.properties.comfytv_photoshop_layer = payload.layer
  if (payload.layer) node.title = `Photoshop: ${payload.layer}`

  const value = `${payload.subfolder}/${payload.name}`
  const widget = getWidget(node, 'image') as any
  const values = widget?.options?.values
  if (Array.isArray(values) && !values.includes(value)) values.push(value)
  writeWidget(node, 'image', value)

  host?.graph?.setDirtyCanvas?.(true, true)
  if (selected) host?.canvas?.selectNode?.(node)
  host?.canvas?.centerOnNode?.(node)
  return node
}

let installed = false

export function installPhotoshopBridge(host: any = app): void {
  if (installed) return
  installed = true
  host?.api?.addEventListener?.(PHOTOSHOP_LAYER_EVENT, (event: any) => {
    const payload = (event?.detail ?? event) as PhotoshopLayerPayload
    const node = applyPhotoshopLayer(host, payload)
    host?.extensionManager?.toast?.add?.({
      severity: node ? 'success' : 'error',
      summary: 'Photoshop',
      detail: node
        ? `${payload.layer || payload.name} received`
        : 'Image loader could not be created',
      life: 4000,
    })
  })
}
