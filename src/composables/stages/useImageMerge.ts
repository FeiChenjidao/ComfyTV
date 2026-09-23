import { computed, ref, watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { app } from '@/lib/comfyApp'
import { useStageStore, type StageState } from '@/stores/stageStore'
import { uploadBlob } from '@/utils/uploadCanvas'
import { useStrWidget } from '@/composables/widgets/useWidgetModel'
import { useChainCallback } from '@/composables/functional/useChainCallback'

import {
  collectMergeUrlsFromSources,
  countLinkedMergeSlots,
  ensureMergeImageSockets,
  mergeImages,
  parseMergeAspect,
  parseMergeMode,
  type MergeAspect,
  type MergeMode,
} from './imageMerge'
import { loadLayerImage } from './useImagesSplit'

export function useImageMerge(node: LGraphNode, state: StageState) {
  const store = useStageStore()
  const mergeMode = useStrWidget(node, 'merge_mode', 'layers')
  const aspectRatio = useStrWidget(node, 'aspect_ratio', 'native')
  const computing = ref(false)
  let timer: number | null = null
  let computeSeq = 0
  let lastKey = ''
  const linksTick = ref(0)

  function liveUrls() {
    return collectMergeUrlsFromSources({
      inputs: state.inputs,
      nodeInputs: node?.inputs,
      resolveLink: (linkId) => store.resolveUpstreamValue(app as any, linkId),
    })
  }

  const urls = computed(() => {
    void store.stateTick
    void linksTick.value
    void state.inputs.map(i => `${i.slot}:${i.source}:${i.content ?? ''}`).join('|')
    return liveUrls()
  })
  const mode = computed({
    get: (): MergeMode => parseMergeMode(mergeMode.value),
    set: (v: MergeMode) => { mergeMode.value = parseMergeMode(v) },
  })
  const aspect = computed({
    get: (): MergeAspect => parseMergeAspect(aspectRatio.value),
    set: (v: MergeAspect) => { aspectRatio.value = parseMergeAspect(v) },
  })
  const square = computed({
    get: () => aspect.value === '1:1',
    set: (on: boolean) => { aspect.value = on ? '1:1' : 'native' },
  })
  const previewUrl = computed(() => state.output || urls.value[0] || null)
  const inputCount = computed(() => {
    void store.stateTick
    void linksTick.value
    const fromState = countLinkedMergeSlots(state.inputs)
    const fromNode = countLinkedMergeSlots(node?.inputs)
    return Math.max(fromState, fromNode, urls.value.length)
  })

  function signature() {
    return `${parseMergeMode(mergeMode.value)}|${parseMergeAspect(aspectRatio.value)}|${urls.value.join('\n')}`
  }

  const anyNode = node as any
  ensureMergeImageSockets(anyNode, (app as any)?.graph)
  anyNode.onConnectionsChange = useChainCallback(anyNode.onConnectionsChange, () => {
    ensureMergeImageSockets(anyNode, (app as any)?.graph)
    linksTick.value++
    queueMicrotask(() => { linksTick.value++ })
    window.setTimeout(() => { linksTick.value++ }, 50)
  })

  function requestRecompute() {
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void run()
    }, 200)
  }

  async function run() {
    const list = liveUrls()
    const key = `${parseMergeMode(mergeMode.value)}|${parseMergeAspect(aspectRatio.value)}|${list.join('\n')}`
    if (!list.length) return
    const mySeq = ++computeSeq
    computing.value = true
    try {
      const images = await Promise.all(list.map(loadLayerImage))
      if (mySeq !== computeSeq) return
      const canvas = mergeImages(
        images,
        parseMergeMode(mergeMode.value),
        parseMergeAspect(aspectRatio.value),
      )
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) return
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      canvas.width = 0
      canvas.height = 0
      if (!blob) throw new Error('toBlob returned null')
      if (mySeq !== computeSeq) return
      const viewUrl = await uploadBlob(blob, {
        subfolder: 'comfytv/transformer',
        filename: `comfytv-merge-${node?.id ?? 'x'}-${Date.now()}.png`,
      })
      if (mySeq !== computeSeq) return
      lastKey = key
      store.applyExecutedPayload(state, { output: [viewUrl] })
    } catch (e) {
      console.error('[ComfyTV/image-merge] compute failed', e)
    } finally {
      if (mySeq === computeSeq) computing.value = false
    }
  }

  watch(
    () => signature(),
    (key) => {
      if (key === lastKey) return
      if (urls.value.length) requestRecompute()
    },
    { immediate: true },
  )

  return { urls, mode, aspect, square, previewUrl, computing, inputCount }
}
