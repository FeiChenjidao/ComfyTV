import type { Pinia } from 'pinia'

import type { Asset } from '@/api/schemas'
import { clientToCanvasPos, createAssetLoaderNode } from '@/composables/stages/assetLoaderNode'
import { app } from '@/lib/comfyApp'
import { useAssetStore } from '@/stores/assetStore'

export const ASSET_DRAG_MIME = 'application/x-comfytv-asset-id'
export const EAGLE_DRAG_MIME = 'application/x-comfytv-eagle-item'

export type ResolveAsset = (id: number) => Asset | null

const MULTI_DROP_STEP = 40

export function parseAssetDragIds(raw: string): number[] {
  const out: number[] = []
  for (const part of raw.split(',')) {
    const id = Number(part.trim())
    if (part.trim() && Number.isFinite(id) && !out.includes(id)) out.push(id)
  }
  return out
}

function hasMime(e: DragEvent, mime: string): boolean {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes(mime)
}

export function handleAssetDragOver(e: DragEvent): void {
  if (!hasMime(e, ASSET_DRAG_MIME) && !hasMime(e, EAGLE_DRAG_MIME)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

export function handleAssetDrop(e: DragEvent, resolveAsset: ResolveAsset): void {
  if (hasMime(e, EAGLE_DRAG_MIME)) {
    e.preventDefault()
    e.stopPropagation()
    const eagleId = e.dataTransfer?.getData(EAGLE_DRAG_MIME) ?? ''
    if (!eagleId) return
    const pos = clientToCanvasPos(e.clientX, e.clientY)
    void (async () => {
      try {
        const { importEagleItem } = await import('@/api/eagle')
        const res = await importEagleItem(eagleId)
        if (res.asset) {
          createAssetLoaderNode(res.asset, pos, { anchor: 'center', select: true })
        }
      } catch (err) {
        console.warn('[ComfyTV/eagle] drop import failed:', err)
      }
    })()
    return
  }

  if (!hasMime(e, ASSET_DRAG_MIME)) return
  e.preventDefault()
  e.stopPropagation()

  const raw = e.dataTransfer?.getData(ASSET_DRAG_MIME) ?? ''
  const assets = parseAssetDragIds(raw).map(resolveAsset).filter((a): a is Asset => !!a)
  if (!assets.length) {
    console.warn('[ComfyTV/assets] dropped asset not found:', raw)
    return
  }
  const [x, y] = clientToCanvasPos(e.clientX, e.clientY)
  assets.forEach((asset, i) => {
    createAssetLoaderNode(asset, [x + i * MULTI_DROP_STEP, y + i * MULTI_DROP_STEP], {
      anchor: 'center',
      select: true,
    })
  })
}

let installed = false

export function installAssetCanvasDrop(pinia: Pinia): void {
  if (installed) return
  installed = true

  const resolveAsset: ResolveAsset = (id) => useAssetStore(pinia).byId(id) ?? null

  let tries = 0
  const tryInstall = () => {
    const el = (app as any)?.canvas?.canvas as HTMLCanvasElement | undefined
    if (!el) {
      if (tries++ < 1200) requestAnimationFrame(tryInstall)
      else console.warn('[ComfyTV/assets] graph canvas never appeared; drag-to-canvas disabled')
      return
    }
    el.addEventListener('dragover', handleAssetDragOver)
    el.addEventListener('drop', (e) => handleAssetDrop(e, resolveAsset))
  }
  tryInstall()
}
