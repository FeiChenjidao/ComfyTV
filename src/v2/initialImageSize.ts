import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import { onScopeDispose, watch, type EffectScope } from 'vue'

import { loadMediaInfo } from '@/composables/stages/useMediaInfo'
import { app, type ComfyNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { previewUrlFromPayload } from '@/v2/mediaItems'

const FIT_PROP = 'v2_initial_image_fit'
const IMAGE_KINDS = new Set(['image', 'image-batch', 'image-picker', 'panorama'])
const IMAGE_TYPES = new Set(['COMFYTV_IMAGE', 'COMFYTV_IMAGES', 'COMFYTV_PANORAMA'])

export function initialImagePreviewSize(width: number, height: number): [number, number] {
  const ratio = width / height
  const w = Math.max(320, Math.min(720, Math.sqrt(360 * 360 * ratio)))
  return [Math.round(w), Math.round(Math.max(170, Math.min(720, w / ratio)))]
}

export function initialImageUrl(state: StageState): string {
  let waitingForInput = false
  for (const input of state.inputs) {
    if (!IMAGE_TYPES.has(input.type)) continue
    const url = previewUrlFromPayload(input.content)
    if (url) return url
    if (input.source === 'upstream' || input.source === 'upstream-pending') waitingForInput = true
  }
  if (waitingForInput) return ''
  return previewUrlFromPayload(state.output) || previewUrlFromPayload(state.pool) || ''
}

export function bindInitialImageSize(node: ComfyNode, opts: {
  scope: EffectScope
  state: StageState
  card: HTMLElement
  box: () => HTMLElement
  resize: (nodeWidth: number, previewHeight: number) => boolean
}) {
  const anyNode = node as any
  if (!IMAGE_KINDS.has(opts.state.kind) || anyNode.__comfytvFromSave || anyNode.properties?.[FIT_PROP]) return
  let stopped = false
  let dimensions: [number, number] | null = null
  let revision = 0
  let release = () => {}
  const createdWidth = node.size[0]

  const finish = () => {
    stopped = true
    ;(anyNode.properties ??= {})[FIT_PROP] = true
    release()
  }
  const fit = () => {
    if (stopped || !dimensions || anyNode.__comfytvFromSave) return
    // A resize gesture before the image arrives takes precedence over automatic sizing.
    if ((app as any).canvas?.resizing_node === node || Math.abs(node.size[0] - createdWidth) > 1) {
      finish()
      return
    }
    const box = opts.box()
    if (!(opts.card.offsetHeight > 0 && box.clientWidth > 0 && box.offsetHeight > 0)) return
    const [width, height] = initialImagePreviewSize(...dimensions)
    const border = Math.max(0, node.size[0] - box.clientWidth)
    if (opts.resize(width + border, height)) finish()
  }

  opts.scope.run(() => {
    const stopWatch = watch(() => initialImageUrl(opts.state), async (url) => {
      const current = ++revision
      dimensions = null
      if (stopped || !url || anyNode.__comfytvFromSave) return
      const info = await loadMediaInfo(url)
      if (stopped || current !== revision || anyNode.__comfytvFromSave) return
      const width = Number(info?.width)
      const height = Number(info?.height)
      if (info?.kind !== 'image' || !(width > 0 && height > 0) || !Number.isFinite(width + height)) return
      dimensions = [width, height]
      fit()
    }, { immediate: true })
    const resizeObserver = useResizeObserver(opts.card, fit)
    const mutationObserver = useMutationObserver(opts.card, fit, { childList: true, subtree: true })
    const onResize = anyNode.onResize
    const resized = function (this: unknown, ...args: unknown[]) {
      if (!stopped && (app as any).canvas?.resizing_node === node) finish()
      return onResize?.apply(this, args)
    }
    anyNode.onResize = resized
    release = () => {
      stopped = true
      ++revision
      stopWatch()
      resizeObserver.stop()
      mutationObserver.stop()
      if (anyNode.onResize === resized) anyNode.onResize = onResize
    }
    onScopeDispose(release)
  })
}
