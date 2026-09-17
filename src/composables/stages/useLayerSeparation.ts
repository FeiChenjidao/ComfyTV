import { watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { isPsdAsset } from '@/utils/assetMedia'
import type { StageState } from '@/stores/stageStore'

import { usePsdLayerTree } from './usePsdLayerTree'

/** PSD Layer Tree compositor driven by Layer Separation workflow output. */
export function useLayerSeparation(node: LGraphNode, state: StageState) {
  const api = usePsdLayerTree(node, state)
  let lastLoaded = ''

  watch(
    () => state.output,
    (raw) => {
      const url = String(raw || '').trim()
      if (!url || url === lastLoaded || url.startsWith('{')) return
      if (!isPsdAsset({ payload_url: url })) return
      lastLoaded = url
      void api.loadFromUrl(url)
    },
    { immediate: true },
  )

  return api
}
