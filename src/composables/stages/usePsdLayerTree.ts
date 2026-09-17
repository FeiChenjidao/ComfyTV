import { computed, ref } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { t } from '@/i18n'
import { useStageStore, type StageState } from '@/stores/stageStore'
import { uploadBlobNamed, uploadCanvas } from '@/utils/uploadCanvas'
import { getWidget, readWidgetStr, writeWidget } from '@/utils/widget'

import {
  collectClipMaskSources,
  collectRasters,
  compositeSubtree,
  fitCompositeSize,
  defaultCollapsedIds,
  flattenPsdTree,
  isolateSelected,
  isMemoryError,
  opaqueBounds,
  cropToBounds,
  parseSelectedIds,
  PSD_ROOT_ID,
  rangeSelectIds,
  releaseContents,
  sceneFromPsdLayers,
  serializeSelectedIds,
  shouldAutoComposite,
  shrinkCanvasInPlace,
  visibleTreeRows,
  type ContentMap,
  type PsdLayerLike,
  type PsdTreeRow,
} from './psdLayerTree'

export { PSD_ROOT_ID }
export type { PsdTreeRow }

const SCHEDULE_DELAY_MS = 250
const PSD_SUBFOLDER = 'comfytv/psd'
const OUT_SUBFOLDER = 'comfytv/psdlayer'

const READ_OPTS = {
  skipThumbnail: true,
  skipCompositeImageData: true,
  skipLinkedFilesData: true,
  useRawData: true,
} as const

export function viewUrlFromUpload(name: string, subfolder: string): string {
  return `/view?filename=${encodeURIComponent(name)}`
    + `&subfolder=${encodeURIComponent(subfolder)}&type=input`
}

export async function parsePsdBuffer(
  buffer: ArrayBuffer,
  sourceName = 'Document',
): Promise<{
  width: number
  height: number
  nodes: ReturnType<typeof sceneFromPsdLayers>['nodes']
  layerMap: Map<string, PsdLayerLike>
  warnings: string[]
  rootName: string
}> {
  const { readPsd } = await import('ag-psd')
  const psd = readPsd(buffer, { ...READ_OPTS })
  const { nodes, layerMap } = sceneFromPsdLayers(psd.children as PsdLayerLike[] | undefined)
  const rootName = sourceName.replace(/\.(psd|psb)$/i, '') || 'Document'
  return {
    width: Math.max(1, Number(psd.width) || 1),
    height: Math.max(1, Number(psd.height) || 1),
    nodes,
    layerMap,
    warnings: [],
    rootName,
  }
}

export function usePsdLayerTree(node: LGraphNode, state: StageState) {
  const store = useStageStore()

  const fileName = ref('')
  const width = ref(0)
  const height = ref(0)
  const nodes = ref<ReturnType<typeof sceneFromPsdLayers>['nodes']>([])
  const warnings = ref<string[]>([])
  const selectedIds = ref<string[]>(
    parseSelectedIds(readWidgetStr(node, 'selected_id', '')) || [],
  )
  if (!selectedIds.value.length) selectedIds.value = [PSD_ROOT_ID]
  const selectedId = computed(() => selectedIds.value[0] ?? '')
  const selectedSet = computed(() => new Set(selectedIds.value))
  const previewUrl = ref(readWidgetStr(node, 'captured_image', ''))
  const loading = ref(false)
  const compositing = ref(false)
  const error = ref<string | null>(null)
  const outWidth = ref(0)
  const outHeight = ref(0)
  const collapsed = ref<Set<string>>(new Set())

  let contents: ContentMap = new Map()
  let layerMap = new Map<string, PsdLayerLike>()
  let timer: number | null = null
  let seq = 0
  let lastAnchor = selectedIds.value[0] ?? PSD_ROOT_ID

  const rows = computed(() => flattenPsdTree(nodes.value, fileName.value || 'Document'))
  const displayedRows = computed(() => visibleTreeRows(rows.value, collapsed.value))
  const selectedRow = computed(() => rows.value.find(r => r.id === selectedId.value) ?? null)

  function persistSelection() {
    writeWidget(node, 'selected_id', serializeSelectedIds(selectedIds.value))
  }

  function restoreSelection(raw: string) {
    const parsed = parseSelectedIds(raw)
    selectedIds.value = parsed.length ? parsed : [PSD_ROOT_ID]
    lastAnchor = selectedIds.value[0] ?? PSD_ROOT_ID
  }

  function restoreOutputs() {
    previewUrl.value = readWidgetStr(node, 'captured_image', '')
    const batch = readWidgetStr(node, 'captured_images', '')
    store.setOutputSlot(state, 0, previewUrl.value || null)
    store.setOutputSlot(state, 1, batch || null)
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsed.value = next
  }

  function selectId(id: string, mods?: { toggle?: boolean; range?: boolean }) {
    if (!nodes.value.length) return
    if (!id) {
      selectedIds.value = []
      persistSelection()
      schedule()
      return
    }
    if (mods?.range && lastAnchor) {
      selectedIds.value = rangeSelectIds(displayedRows.value.map(r => r.id), lastAnchor, id)
    } else if (mods?.toggle) {
      const set = new Set(selectedIds.value)
      if (id === PSD_ROOT_ID) {
        selectedIds.value = set.has(PSD_ROOT_ID) && selectedIds.value.length === 1
          ? []
          : [PSD_ROOT_ID]
      } else {
        set.delete(PSD_ROOT_ID)
        if (set.has(id)) set.delete(id)
        else set.add(id)
        selectedIds.value = [...set]
      }
      lastAnchor = id
    } else {
      selectedIds.value = [id]
      lastAnchor = id
    }
    persistSelection()
    schedule()
  }

  function selectRow(id: string, e: MouseEvent) {
    selectId(id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })
  }

  function fail(e: unknown, fallback: string) {
    console.error('[ComfyTV/psdlayer]', fallback, e)
    error.value = isMemoryError(e) ? t('psdLayerTree.memory') : (e instanceof Error ? e.message : fallback)
  }

  async function ingestBuffer(buffer: ArrayBuffer, name: string, persistUrl?: string) {
    loading.value = true
    error.value = null
    try {
      const parsed = await parsePsdBuffer(buffer, name)
      releaseContents(contents)
      layerMap = parsed.layerMap
      nodes.value = parsed.nodes
      width.value = parsed.width
      height.value = parsed.height
      warnings.value = parsed.warnings
      fileName.value = parsed.rootName
      collapsed.value = defaultCollapsedIds(flattenPsdTree(parsed.nodes, parsed.rootName))
      if (persistUrl) writeWidget(node, 'psd_file', persistUrl, { fireCallback: false })
      selectedIds.value = selectedIds.value.filter(id => id === PSD_ROOT_ID || findRow(id))
      if (!selectedIds.value.length) selectedIds.value = [PSD_ROOT_ID]
      lastAnchor = selectedIds.value[0] ?? PSD_ROOT_ID
      persistSelection()
      const rasters = collectRasters(parsed.nodes).length
      if (shouldAutoComposite(parsed.width, parsed.height, rasters)) schedule()
    } catch (e) {
      fail(e, 'parse failed')
      releaseContents(contents)
      layerMap = new Map()
      nodes.value = []
    } finally {
      loading.value = false
    }
  }

  function findRow(id: string) {
    return flattenPsdTree(nodes.value).some(r => r.id === id)
  }

  async function pickFiles(files: File[]) {
    const file = files.find(f => /\.(psd|psb)$/i.test(f.name) || f.type.includes('photoshop'))
    if (!file) return
    let persistUrl = ''
    try {
      const uploaded = await uploadBlobNamed(file, { subfolder: PSD_SUBFOLDER, filename: file.name })
      persistUrl = uploaded.url
    } catch (e) {
      console.warn('[ComfyTV/psdlayer] PSD upload failed; using in-memory file', e)
    }
    await ingestBuffer(await file.arrayBuffer(), file.name, persistUrl)
  }

  async function loadFromWidgetUrl() {
    const url = readWidgetStr(node, 'psd_file', '')
    if (!url) return
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`psd fetch ${resp.status}`)
      const name = new URLSearchParams(url.split('?')[1] ?? '').get('filename') || 'Document.psd'
      await ingestBuffer(await resp.arrayBuffer(), decodeURIComponent(name), url)
    } catch (e) {
      fail(e, 'reload failed')
    } finally {
      loading.value = false
    }
  }

  async function loadFromUrl(url: string) {
    const next = String(url || '').trim()
    if (!next) return
    writeWidget(node, 'psd_file', next, { fireCallback: false })
    await loadFromWidgetUrl()
  }

  function schedule() {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
    if (!nodes.value.length || !selectedIds.value.length) return
    timer = window.setTimeout(() => { timer = null; void run() }, SCHEDULE_DELAY_MS)
  }

  async function decodeIsolated(isolated: typeof nodes.value) {
    const { getLayerCanvas, getLayerMaskCanvas } = await import('ag-psd')
    releaseContents(contents)
    const fit = fitCompositeSize(width.value, height.value)
    const extra = collectClipMaskSources(nodes.value, isolated)
    const rasters = [
      ...collectRasters(isolated),
      ...collectRasters(extra),
    ]
    const seen = new Set<string>()
    for (const raster of rasters) {
      if (seen.has(raster.id)) continue
      seen.add(raster.id)
      const extraRasters = new Set(collectRasters(extra).map(r => r.id))
      if (!raster.visible && !extraRasters.has(raster.id)) continue
      const layer = layerMap.get(raster.id)
      if (!layer) continue
      try {
        let canvas = getLayerCanvas(layer as never)
        if (!canvas) continue
        canvas = shrinkCanvasInPlace(canvas, fit.scale)
        contents.set(raster.contentId, canvas)
        if (raster.mask?.enabled) {
          let mask = getLayerMaskCanvas(layer as never)
          if (mask) {
            mask = shrinkCanvasInPlace(mask, fit.scale)
            contents.set(raster.mask.contentId, mask)
          }
        }
      } catch (e) {
        if (isMemoryError(e)) throw e
        console.warn('[ComfyTV/psdlayer] layer decode skipped', raster.name, e)
      }
    }
  }

  async function run() {
    if (!nodes.value.length || !selectedIds.value.length) return
    const mySeq = ++seq
    compositing.value = true
    try {
      const isolated = isolateSelected(nodes.value, selectedIds.value)
      if (!isolated.length && !selectedIds.value.includes(PSD_ROOT_ID)) return
      await decodeIsolated(isolated)
      if (mySeq !== seq) return
      const canvas = compositeSubtree(width.value, height.value, isolated, contents, true, nodes.value)
      if (mySeq !== seq) return
      const unionW = canvas.width
      const unionH = canvas.height
      const used = opaqueBounds(canvas)
      const preview = cropToBounds(canvas, used)
      outWidth.value = preview.width
      outHeight.value = preview.height
      const nodeId = String(node?.id ?? 'unknown')
      const stamp = Date.now()
      const imageUrl = await uploadCanvas(preview, {
        subfolder: OUT_SUBFOLDER,
        filename: `comfytv-psdlayer-${nodeId}-${stamp}.png`,
      })
      preview.width = 0
      preview.height = 0
      if (mySeq !== seq) return

      const items: { index: string; label: string; image_url: string }[] = []
      if (isolated.length === 1) {
        items.push({
          index: '1',
          label: isolated[0].name || isolated[0].kind,
          image_url: imageUrl,
        })
      } else {
        for (let i = 0; i < isolated.length; i++) {
          if (mySeq !== seq) return
          const cell = compositeSubtree(width.value, height.value, [isolated[i]], contents, true, nodes.value)
          const cropped = cropToBounds(cell, used, unionW, unionH)
          const cellUrl = await uploadCanvas(cropped, {
            subfolder: OUT_SUBFOLDER,
            filename: `comfytv-psdlayer-${nodeId}-${stamp}-${i + 1}.png`,
          })
          cropped.width = 0
          cropped.height = 0
          items.push({
            index: String(i + 1),
            label: isolated[i].name || isolated[i].kind,
            image_url: cellUrl,
          })
        }
      }
      releaseContents(contents)
      if (mySeq !== seq) return
      const batch = JSON.stringify({ images: items })
      writeWidget(node, 'captured_image', imageUrl)
      writeWidget(node, 'captured_images', batch)
      previewUrl.value = imageUrl
      store.applyExecutedPayload(state, { output: [imageUrl], picked: [batch] })
      error.value = null
    } catch (e) {
      fail(e, 'composite failed')
    } finally {
      if (mySeq === seq) compositing.value = false
    }
  }

  {
    const orig = getWidget(node, 'psd_file')
    if (orig) {
      const prev = orig.callback
      orig.callback = (val: unknown) => {
        prev?.call(orig, val)
        const next = String(val ?? '')
        if (next) void loadFromWidgetUrl()
      }
    }
  }

  if (node) {
    const orig = node.onConfigure
    node.onConfigure = function (info: any) {
      orig?.call(this, info)
      restoreSelection(readWidgetStr(node, 'selected_id', ''))
      restoreOutputs()
      void loadFromWidgetUrl()
    }
  }

  if (readWidgetStr(node, 'psd_file', '')) void loadFromWidgetUrl()
  restoreOutputs()

  return {
    fileName, width, height, outWidth, outHeight,
    rows, displayedRows, selectedId, selectedIds, selectedSet, selectedRow,
    warnings, loading, compositing, error, previewUrl,
    collapsed, toggleCollapsed, selectId, selectRow, pickFiles, loadFromUrl,
  }
}
