import { computed, getCurrentInstance, onUnmounted, ref } from 'vue'

import { app, type LGraphNode } from '@/lib/comfyApp'
import { t } from '@/i18n'
import { useStageStore, type StageState } from '@/stores/stageStore'
import { uploadCanvas } from '@/utils/uploadCanvas'
import { getWidget, readWidgetStr, writeWidget } from '@/utils/widget'

import {
  collectClipMaskSources,
  collectRasters,
  compositeExport,
  compositePreview,
  defaultCollapsedIds,
  flattenPsdTree,
  isolateSelected,
  isMemoryError,
  parseSelectedIds,
  PSD_ROOT_ID,
  rangeSelectIds,
  releaseContents,
  sceneFromPsdLayers,
  serializeSelectedIds,
  visibleTreeRows,
  type ContentMap,
  type PsdLayerLike,
  type PsdTreeRow,
} from './psdLayerTree'

export { PSD_ROOT_ID }
export type { PsdTreeRow }

const PREVIEW_DELAY_MS = 80
const OUT_SUBFOLDER = 'comfytv/psdlayer'

/** Absolute local path, or legacy Comfy `/view?...` URL from older builds. */
export function isLocalPsdPath(raw: string): boolean {
  const s = String(raw || '').trim()
  if (!s) return false
  if (s.startsWith('/view?') || s.startsWith('http://') || s.startsWith('https://')) return false
  return true
}

export function localPsdFetchUrl(path: string): string {
  return `/comfytv/psd/local?path=${encodeURIComponent(path)}`
}

export function basenameOfPath(path: string): string {
  const s = String(path || '').replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

function fileLocalPath(file: File): string {
  const p = String((file as File & { path?: string }).path || '').trim()
  return p
}

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

function selectionKey(ids: string[]): string {
  return serializeSelectedIds([...ids].sort())
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
  const previewUrl = ref('')
  const loading = ref(false)
  const compositing = ref(false)
  const exporting = ref(false)
  const dirty = ref(true)
  const error = ref<string | null>(null)
  const outWidth = ref(0)
  const outHeight = ref(0)
  const collapsed = ref<Set<string>>(new Set())

  let contents: ContentMap = new Map()
  let displayObjectUrl = ''
  let layerMap = new Map<string, PsdLayerLike>()
  let previewTimer: number | null = null
  let previewSeq = 0
  let exportSeq = 0
  let lastAnchor = selectedIds.value[0] ?? PSD_ROOT_ID
  let lastExportedKey = ''
  const previewCache = new Map<string, string>()
  const finalCache = new Map<string, { imageUrl: string; batch: string; w: number; h: number }>()

  function revokeDisplayPreview() {
    if (!displayObjectUrl) return
    URL.revokeObjectURL(displayObjectUrl)
    displayObjectUrl = ''
  }

  function clearCaches() {
    revokeDisplayPreview()
    for (const url of previewCache.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    previewCache.clear()
    finalCache.clear()
    lastExportedKey = ''
  }

  function canvasToObjectUrl(
    canvas: HTMLCanvasElement,
    type = 'image/jpeg',
    quality = 0.85,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('preview encode failed'))
          return
        }
        resolve(URL.createObjectURL(blob))
      }, type, quality)
    })
  }

  async function publishDisplayPreview(source: HTMLCanvasElement) {
    revokeDisplayPreview()
    const url = await canvasToObjectUrl(source)
    displayObjectUrl = url
    previewUrl.value = url
  }

  const rows = computed(() => flattenPsdTree(nodes.value, fileName.value || 'Document'))
  const displayedRows = computed(() => visibleTreeRows(rows.value, collapsed.value))
  const selectedRow = computed(() => rows.value.find(r => r.id === selectedId.value) ?? null)

  function markGraphDirty() {
    node?.setDirtyCanvas?.(true, true)
  }

  function persistSelection() {
    writeWidget(node, 'selected_id', serializeSelectedIds(selectedIds.value))
    markGraphDirty()
  }

  function restoreSelection(raw: string) {
    const parsed = parseSelectedIds(raw)
    selectedIds.value = parsed.length ? parsed : [PSD_ROOT_ID]
    lastAnchor = selectedIds.value[0] ?? PSD_ROOT_ID
  }

  function restoreOutputs() {
    const imageUrl = readWidgetStr(node, 'captured_image', '')
    const batch = readWidgetStr(node, 'captured_images', '')
    // Always write both slots then force-notify: setOutputSlot skips notify when the
    // value is unchanged, which races workflow reopen (ImagesSplit refresher may
    // register after the first restore and never see the cached full-res batch).
    store.setOutputSlot(state, 0, imageUrl || null)
    store.setOutputSlot(state, 1, batch || null)
    store.notifyConsumers(state)
    const key = selectionKey(selectedIds.value)
    if (imageUrl && batch) {
      const w = Number(readWidgetStr(node, 'out_width', '0')) || outWidth.value || 0
      const h = Number(readWidgetStr(node, 'out_height', '0')) || outHeight.value || 0
      finalCache.set(key, { imageUrl, batch, w, h })
      if (w) outWidth.value = w
      if (h) outHeight.value = h
      lastExportedKey = key
      dirty.value = false
    } else {
      dirty.value = !!nodes.value.length
    }
  }

  /** Re-publish widget-backed exports after a PSD reload wiped in-memory caches. */
  function restoreOutputsAfterReload() {
    restoreOutputs()
    // Late-mounted downstream cards (ImagesSplit etc.) register refreshers after the
    // first notify; a microtask + rAF pass covers both mount timings.
    queueMicrotask(() => store.notifyConsumers(state))
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => store.notifyConsumers(state))
    }
  }

  function markDirty() {
    dirty.value = selectionKey(selectedIds.value) !== lastExportedKey
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
      markDirty()
      schedulePreview()
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
    markDirty()
    schedulePreview()
  }

  function selectRow(id: string, e: MouseEvent) {
    selectId(id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })
  }

  function fail(e: unknown, fallback: string) {
    console.error('[ComfyTV/psdlayer]', fallback, e)
    error.value = isMemoryError(e) ? t('psdLayerTree.memory') : (e instanceof Error ? e.message : fallback)
  }

  async function ingestBuffer(buffer: ArrayBuffer, name: string, persistPath?: string) {
    const parsed = await parsePsdBuffer(buffer, name)
    releaseContents(contents)
    clearCaches()
    layerMap = parsed.layerMap
    nodes.value = parsed.nodes
    width.value = parsed.width
    height.value = parsed.height
    warnings.value = parsed.warnings
    fileName.value = parsed.rootName
    collapsed.value = defaultCollapsedIds(flattenPsdTree(parsed.nodes, parsed.rootName))
    if (persistPath) {
      writeWidget(node, 'psd_file', persistPath, { fireCallback: false })
      markGraphDirty()
    }
    selectedIds.value = selectedIds.value.filter(id => id === PSD_ROOT_ID || findRow(id))
    if (!selectedIds.value.length) selectedIds.value = [PSD_ROOT_ID]
    lastAnchor = selectedIds.value[0] ?? PSD_ROOT_ID
    persistSelection()
    // clearCaches wiped finalCache / lastExportedKey — reinstate full-res outputs from
    // widgets so downstream stages keep working across reopen without re-export.
    restoreOutputsAfterReload()
    schedulePreview()
  }

  function findRow(id: string) {
    return flattenPsdTree(nodes.value).some(r => r.id === id)
  }

  async function openLocalPath(path: string) {
    const abs = String(path || '').trim()
    if (!abs) return
    loading.value = true
    error.value = null
    try {
      const resp = await (app as any).api.fetchApi(localPsdFetchUrl(abs))
      if (resp.status === 404) {
        error.value = t('psdLayerTree.pathMissing')
        releaseContents(contents)
        layerMap = new Map()
        nodes.value = []
        fileName.value = basenameOfPath(abs).replace(/\.(psd|psb)$/i, '') || ''
        return
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { message?: string }
        throw new Error(body.message || `psd read ${resp.status}`)
      }
      const name = basenameOfPath(abs) || 'Document.psd'
      await ingestBuffer(await resp.arrayBuffer(), name, abs)
    } catch (e) {
      fail(e, 'reload failed')
      releaseContents(contents)
      layerMap = new Map()
      nodes.value = []
    } finally {
      loading.value = false
    }
  }

  /** Native OS dialog on the ComfyUI host — remembers absolute path, no copy. */
  async function pickLocalPsd() {
    error.value = null
    try {
      const resp = await (app as any).api.fetchApi('/comfytv/psd/pick', { method: 'POST' })
      const data = await resp.json().catch(() => ({})) as {
        ok?: boolean
        cancelled?: boolean
        path?: string
        error?: string
      }
      if (data.cancelled) return
      if (!resp.ok || !data.ok || !data.path) {
        throw new Error(data.error || `pick ${resp.status}`)
      }
      await openLocalPath(data.path)
    } catch (e) {
      fail(e, 'pick failed')
    }
  }

  async function pickFiles(files: File[]) {
    const file = files.find(f => /\.(psd|psb)$/i.test(f.name) || f.type.includes('photoshop'))
    if (!file) return
    const path = fileLocalPath(file)
    if (!path) {
      error.value = t('psdLayerTree.pathUnavailable')
      return
    }
    await openLocalPath(path)
  }

  async function loadFromWidgetUrl() {
    const stored = readWidgetStr(node, 'psd_file', '')
    if (!stored) return
    if (isLocalPsdPath(stored)) {
      await openLocalPath(stored)
      return
    }
    // Legacy /view? upload URL from older builds
    loading.value = true
    error.value = null
    try {
      const resp = await fetch(stored)
      if (!resp.ok) {
        error.value = t('psdLayerTree.pathMissing')
        return
      }
      const name = new URLSearchParams(stored.split('?')[1] ?? '').get('filename') || 'Document.psd'
      await ingestBuffer(await resp.arrayBuffer(), decodeURIComponent(name), stored)
    } catch (e) {
      fail(e, 'reload failed')
      releaseContents(contents)
      layerMap = new Map()
      nodes.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadFromUrl(url: string) {
    const next = String(url || '').trim()
    if (!next) return
    writeWidget(node, 'psd_file', next, { fireCallback: false })
    markGraphDirty()
    await loadFromWidgetUrl()
  }

  function schedulePreview() {
    if (previewTimer != null) {
      window.clearTimeout(previewTimer)
      previewTimer = null
    }
    if (!nodes.value.length || !selectedIds.value.length) {
      revokeDisplayPreview()
      previewUrl.value = ''
      compositing.value = false
      return
    }
    const key = selectionKey(selectedIds.value)
    const cached = previewCache.get(key)
    if (cached) {
      revokeDisplayPreview()
      previewUrl.value = cached
      return
    }
    previewTimer = window.setTimeout(() => {
      previewTimer = null
      void runPreview()
    }, PREVIEW_DELAY_MS)
  }

  function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  /** Decode missing rasters into the persistent full-res cache. */
  async function ensureDecoded(isolated: typeof nodes.value) {
    const { getLayerCanvas, getLayerMaskCanvas } = await import('ag-psd')
    const extra = collectClipMaskSources(nodes.value, isolated)
    const extraIds = new Set(collectRasters(extra).map(r => r.id))
    const rasters = [
      ...collectRasters(isolated),
      ...collectRasters(extra),
    ]
    const seen = new Set<string>()
    let n = 0
    for (const raster of rasters) {
      if (seen.has(raster.id)) continue
      seen.add(raster.id)
      if (!raster.visible && !extraIds.has(raster.id)) continue
      const needPixels = !contents.has(raster.contentId)
      const needMask = !!(raster.mask?.enabled && !contents.has(raster.mask.contentId))
      if (!needPixels && !needMask) continue
      const layer = layerMap.get(raster.id)
      if (!layer) continue
      try {
        if (needPixels) {
          const canvas = getLayerCanvas(layer as never)
          if (canvas) contents.set(raster.contentId, canvas)
        }
        if (needMask) {
          const mask = getLayerMaskCanvas(layer as never)
          if (mask) contents.set(raster.mask!.contentId, mask)
        }
      } catch (e) {
        if (isMemoryError(e)) throw e
        console.warn('[ComfyTV/psdlayer] layer decode skipped', raster.name, e)
      }
      n++
      if (n % 3 === 0) await yieldToMain()
    }
  }

  async function runPreview() {
    if (!nodes.value.length || !selectedIds.value.length) return
    const mySeq = ++previewSeq
    const key = selectionKey(selectedIds.value)
    compositing.value = true
    try {
      const isolated = isolateSelected(nodes.value, selectedIds.value)
      if (!isolated.length && !selectedIds.value.includes(PSD_ROOT_ID)) return
      await ensureDecoded(isolated)
      if (mySeq !== previewSeq) return

      const preview = compositePreview(
        width.value, height.value, isolated, contents, nodes.value,
      )
      if (mySeq !== previewSeq) {
        preview.width = 0
        preview.height = 0
        return
      }
      await publishDisplayPreview(preview)
      preview.width = 0
      preview.height = 0
      if (mySeq !== previewSeq) return
      if (displayObjectUrl) previewCache.set(key, displayObjectUrl)
      error.value = null
    } catch (e) {
      if (mySeq === previewSeq) fail(e, 'preview failed')
    } finally {
      if (mySeq === previewSeq) compositing.value = false
    }
  }

  async function exportSelection(opts?: { slices?: boolean }) {
    if (!nodes.value.length || !selectedIds.value.length) return
    const key = selectionKey(selectedIds.value)
    const cached = finalCache.get(key)
    if (cached && !opts?.slices) {
      outWidth.value = cached.w
      outHeight.value = cached.h
      writeWidget(node, 'captured_image', cached.imageUrl)
      writeWidget(node, 'captured_images', cached.batch)
      writeWidget(node, 'out_width', String(cached.w), { fireCallback: false })
      writeWidget(node, 'out_height', String(cached.h), { fireCallback: false })
      markGraphDirty()
      store.applyExecutedPayload(state, { output: [cached.imageUrl], picked: [cached.batch] })
      lastExportedKey = key
      dirty.value = false
      error.value = null
      return
    }

    const mySeq = ++exportSeq
    exporting.value = true
    try {
      const isolated = isolateSelected(nodes.value, selectedIds.value)
      if (!isolated.length && !selectedIds.value.includes(PSD_ROOT_ID)) return
      await ensureDecoded(isolated)
      if (mySeq !== exportSeq) return

      const canvas = compositeExport(
        width.value, height.value, isolated, contents, nodes.value,
      )
      if (mySeq !== exportSeq) {
        canvas.width = 0
        canvas.height = 0
        return
      }
      outWidth.value = canvas.width
      outHeight.value = canvas.height
      const nodeId = String(node?.id ?? 'unknown')
      const stamp = Date.now()
      const imageUrl = await uploadCanvas(canvas, {
        subfolder: OUT_SUBFOLDER,
        filename: `comfytv-psdlayer-${nodeId}-${stamp}.png`,
      })
      canvas.width = 0
      canvas.height = 0
      if (mySeq !== exportSeq) return

      const items: { index: string; label: string; image_url: string }[] = []
      if (opts?.slices && isolated.length > 1) {
        for (let i = 0; i < isolated.length; i++) {
          if (mySeq !== exportSeq) return
          const cell = compositeExport(
            width.value, height.value, [isolated[i]], contents, nodes.value,
          )
          const cellUrl = await uploadCanvas(cell, {
            subfolder: OUT_SUBFOLDER,
            filename: `comfytv-psdlayer-${nodeId}-${stamp}-${i + 1}.png`,
          })
          cell.width = 0
          cell.height = 0
          items.push({
            index: String(i + 1),
            label: isolated[i].name || isolated[i].kind,
            image_url: cellUrl,
          })
        }
      } else {
        items.push({
          index: '1',
          label: isolated.length === 1
            ? (isolated[0].name || isolated[0].kind)
            : (fileName.value || 'Selection'),
          image_url: imageUrl,
        })
      }
      if (mySeq !== exportSeq) return

      const batch = JSON.stringify({ images: items })
      writeWidget(node, 'captured_image', imageUrl)
      writeWidget(node, 'captured_images', batch)
      writeWidget(node, 'out_width', String(outWidth.value), { fireCallback: false })
      writeWidget(node, 'out_height', String(outHeight.value), { fireCallback: false })
      markGraphDirty()
      store.applyExecutedPayload(state, { output: [imageUrl], picked: [batch] })
      finalCache.set(key, {
        imageUrl,
        batch,
        w: outWidth.value,
        h: outHeight.value,
      })
      lastExportedKey = key
      dirty.value = false
      error.value = null
    } catch (e) {
      if (mySeq === exportSeq) fail(e, 'export failed')
    } finally {
      if (mySeq === exportSeq) exporting.value = false
    }
  }

  async function expandWithSlices() {
    await exportSelection({ slices: true })
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
      // Restore immediately so StageCard / downstream see full-res URLs even before
      // the PSD file finishes loading for the layer tree preview.
      restoreOutputsAfterReload()
      void loadFromWidgetUrl()
    }
  }

  // Always hydrate widget-backed outputs first. Previously, having a psd_file skipped
  // restoreOutputs entirely — reopen left store.outputs empty while previewUrl still
  // showed the prior capture, so downstream ImagesSplit stayed pending until re-export.
  restoreOutputsAfterReload()
  if (readWidgetStr(node, 'psd_file', '')) void loadFromWidgetUrl()

  // Keep prior captured preview URL only as fallback until low-res preview runs.
  const prior = readWidgetStr(node, 'captured_image', '')
  if (prior && !previewUrl.value) previewUrl.value = prior

  if (getCurrentInstance()) {
    onUnmounted(() => {
      if (previewTimer != null) window.clearTimeout(previewTimer)
      clearCaches()
      releaseContents(contents)
    })
  }

  return {
    fileName, width, height, outWidth, outHeight,
    rows, displayedRows, selectedId, selectedIds, selectedSet, selectedRow,
    warnings, loading, compositing, exporting, dirty, error, previewUrl,
    collapsed, toggleCollapsed, selectId, selectRow, pickFiles, pickLocalPsd,
    loadFromUrl, exportSelection, expandWithSlices,
  }
}
