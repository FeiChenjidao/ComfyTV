import { computed, ref, watch } from 'vue'

import type { LGraphNode } from '@/lib/comfyApp'
import { pickSourceImageUrl } from '@/composables/stages/stageInputs'
import type { Bounds } from '@/composables/widgets/useImageCrop'
import { useStageStore, type StageState } from '@/stores/stageStore'
import { uploadCanvas } from '@/utils/uploadCanvas'
import {
  bindWidgetCallback,
  getWidget,
  onNodeConfigure,
  readWidgetNum,
  readWidgetStr,
  writeWidget,
} from '@/utils/widget'

export const MAX_CROP_BOXES = 16
export const MIN_CROP_BOX = 16

const WIDGETS: Record<keyof Bounds, string> = {
  x: 'crop_x',
  y: 'crop_y',
  width: 'crop_w',
  height: 'crop_h',
}

const BOXES_WIDGET = 'crop_boxes'
const SCHEDULE_DELAY_MS = 200

export interface CropBox extends Bounds {
  id: string
}

export interface CropRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

let _boxSeq = 0
export function nextCropBoxId(): string {
  _boxSeq += 1
  return `b${_boxSeq}`
}

export function clampCropRect(b: Bounds, natW: number, natH: number): CropRect {
  const sx = Math.max(0, Math.min(natW - 1, Math.round(b.x)))
  const sy = Math.max(0, Math.min(natH - 1, Math.round(b.y)))
  const sw = Math.max(1, Math.min(natW - sx, Math.round(b.width)))
  const sh = Math.max(1, Math.min(natH - sy, Math.round(b.height)))
  return { sx, sy, sw, sh }
}

export function cropToCanvas(img: HTMLImageElement, b: Bounds): HTMLCanvasElement {
  const { sx, sy, sw, sh } = clampCropRect(b, img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas
}

export function serializeCropBoxes(boxes: CropBox[]): string {
  return JSON.stringify(boxes.map(b => ({
    id: b.id,
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  })))
}

export function parseCropBoxes(raw: string, fallback: CropBox[] = []): CropBox[] {
  const s = String(raw || '').trim()
  if (!s || s === '[]') return fallback.map(b => ({ ...b }))
  try {
    const parsed = JSON.parse(s)
    if (!Array.isArray(parsed)) return fallback.map(b => ({ ...b }))
    const out: CropBox[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const x = Number((item as any).x)
      const y = Number((item as any).y)
      const w = Number((item as any).w ?? (item as any).width)
      const h = Number((item as any).h ?? (item as any).height)
      if (![x, y, w, h].every(Number.isFinite)) continue
      const id = String((item as any).id || nextCropBoxId())
      out.push({ id, x, y, width: w, height: h })
      if (out.length >= MAX_CROP_BOXES) break
    }
    return out.length ? out : fallback.map(b => ({ ...b }))
  } catch {
    return fallback.map(b => ({ ...b }))
  }
}

function boxFromLegacyWidgets(node: LGraphNode): CropBox | null {
  const w = readWidgetNum(node, WIDGETS.width, 0)
  const h = readWidgetNum(node, WIDGETS.height, 0)
  if (!(w > 0 && h > 0)) return null
  return {
    id: nextCropBoxId(),
    x: readWidgetNum(node, WIDGETS.x, 0),
    y: readWidgetNum(node, WIDGETS.y, 0),
    width: w,
    height: h,
  }
}

export function defaultCropBox(natW: number, natH: number, offset = 0): CropBox {
  const w = Math.max(MIN_CROP_BOX, Math.round(natW * 0.7))
  const h = Math.max(MIN_CROP_BOX, Math.round(natH * 0.7))
  const x = Math.max(0, Math.floor((natW - w) / 2) + offset)
  const y = Math.max(0, Math.floor((natH - h) / 2) + offset)
  return {
    id: nextCropBoxId(),
    x: Math.min(x, Math.max(0, natW - w)),
    y: Math.min(y, Math.max(0, natH - h)),
    width: w,
    height: h,
  }
}

export function useCropStage(node: LGraphNode, state: StageState) {
  const store = useStageStore()
  const sourceImageUrl = computed(() => pickSourceImageUrl(state.inputs))
  const computing = ref(false)

  function readInitialBoxes(): CropBox[] {
    const fromJson = parseCropBoxes(readWidgetStr(node, BOXES_WIDGET, ''))
    if (fromJson.length) return fromJson
    const legacy = boxFromLegacyWidgets(node)
    return legacy ? [legacy] : []
  }

  const boxes = ref<CropBox[]>(readInitialBoxes())
  const selectedId = ref<string>(boxes.value[0]?.id ?? '')

  const selectedBox = computed(() =>
    boxes.value.find(b => b.id === selectedId.value) ?? boxes.value[0] ?? null)

  const bounds = computed<Bounds>(() => {
    const b = selectedBox.value
    return b
      ? { x: b.x, y: b.y, width: b.width, height: b.height }
      : { x: 0, y: 0, width: 0, height: 0 }
  })

  function persistWidgets() {
    writeWidget(node, BOXES_WIDGET, serializeCropBoxes(boxes.value), { fireCallback: false })
    const b = selectedBox.value
    if (b) {
      writeWidget(node, WIDGETS.x, Math.round(b.x), { fireCallback: false })
      writeWidget(node, WIDGETS.y, Math.round(b.y), { fireCallback: false })
      writeWidget(node, WIDGETS.width, Math.round(b.width), { fireCallback: false })
      writeWidget(node, WIDGETS.height, Math.round(b.height), { fireCallback: false })
    }
    const idx = Math.max(1, boxes.value.findIndex(b => b.id === selectedId.value) + 1)
    if (getWidget(node, 'selected_index')) {
      writeWidget(node, 'selected_index', idx, { fireCallback: false })
    }
  }

  function setBounds(v: Bounds): void {
    const id = selectedId.value || boxes.value[0]?.id
    if (!id) {
      const created = { id: nextCropBoxId(), ...v }
      boxes.value = [created]
      selectedId.value = created.id
      return
    }
    boxes.value = boxes.value.map(b => (b.id === id ? { ...b, ...v } : b))
  }

  function selectBox(id: string) {
    if (!boxes.value.some(b => b.id === id)) return
    selectedId.value = id
  }

  function addBox(natW = 0, natH = 0) {
    if (boxes.value.length >= MAX_CROP_BOXES) return
    const offset = boxes.value.length * 24
    const created = natW > 0 && natH > 0
      ? defaultCropBox(natW, natH, offset)
      : {
          id: nextCropBoxId(),
          x: bounds.value.x + 24,
          y: bounds.value.y + 24,
          width: Math.max(MIN_CROP_BOX, bounds.value.width || 256),
          height: Math.max(MIN_CROP_BOX, bounds.value.height || 256),
        }
    boxes.value = [...boxes.value, created]
    selectedId.value = created.id
  }

  function removeSelected() {
    if (boxes.value.length <= 1) return
    const id = selectedId.value
    const next = boxes.value.filter(b => b.id !== id)
    boxes.value = next
    selectedId.value = next[0]?.id ?? ''
  }

  const canAdd = computed(() => boxes.value.length < MAX_CROP_BOXES)
  const canRemove = computed(() => boxes.value.length > 1)

  let timer: number | null = null
  let seq = 0
  let cachedImg: HTMLImageElement | null = null
  let cachedUrl: string | null = null

  function getSourceImage(url: string): Promise<HTMLImageElement> {
    if (cachedImg && cachedUrl === url && cachedImg.complete) {
      return Promise.resolve(cachedImg)
    }
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { cachedImg = img; cachedUrl = url; resolve(img) }
      img.onerror = reject
      img.src = url
    })
  }

  function requestRecompute() {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
    timer = window.setTimeout(() => {
      timer = null
      void run()
    }, SCHEDULE_DELAY_MS)
  }

  async function run() {
    const url = sourceImageUrl.value
    if (!url || !boxes.value.length) return
    if (!boxes.value.some(b => b.width > 0 && b.height > 0)) return

    const mySeq = ++seq
    computing.value = true
    try {
      const img = await getSourceImage(url)
      if (mySeq !== seq) return

      const items: { index: string; label: string; image_url: string }[] = []
      const nodeId = String(node?.id ?? 'unknown')
      const stamp = Date.now()
      for (let i = 0; i < boxes.value.length; i++) {
        if (mySeq !== seq) return
        const box = boxes.value[i]!
        if (!(box.width > 0 && box.height > 0)) continue
        const canvas = cropToCanvas(img, box)
        const imageUrl = await uploadCanvas(canvas, {
          subfolder: 'comfytv/cropper',
          filename: `comfytv-crop-${nodeId}-${stamp}-${i + 1}.png`,
        })
        canvas.width = 0
        canvas.height = 0
        if (mySeq !== seq) return
        items.push({
          index: String(i + 1),
          label: `Crop ${i + 1}`,
          image_url: imageUrl,
        })
      }
      if (!items.length || mySeq !== seq) return

      const selectedIdx = Math.max(1, boxes.value.findIndex(b => b.id === selectedId.value) + 1)
      const picked = items[Math.min(selectedIdx, items.length) - 1]?.image_url ?? items[0]!.image_url
      const batch = JSON.stringify({ images: items })
      store.applyExecutedPayload(state, {
        output: [batch],
        picked: [picked],
        picked_index: [String(selectedIdx)],
      })
    } catch (e) {
      console.error('[ComfyTV/crop] compute failed', e)
    } finally {
      if (mySeq === seq) computing.value = false
    }
  }

  watch(boxes, () => {
    persistWidgets()
    requestRecompute()
  }, { deep: true })

  watch(selectedId, () => {
    persistWidgets()
  })

  for (const key of Object.keys(WIDGETS) as Array<keyof Bounds>) {
    bindWidgetCallback(node, WIDGETS[key], (value) => {
      const v = Number(value)
      if (!Number.isFinite(v)) return
      const cur = selectedBox.value
      if (!cur || cur[key] === v) return
      setBounds({ ...bounds.value, [key]: v })
    })
  }

  bindWidgetCallback(node, BOXES_WIDGET, (value) => {
    const next = parseCropBoxes(String(value ?? ''), boxes.value)
    const same = next.length === boxes.value.length
      && next.every((b, i) => {
        const cur = boxes.value[i]
        return cur && cur.id === b.id && cur.x === b.x && cur.y === b.y
          && cur.width === b.width && cur.height === b.height
      })
    if (same) return
    boxes.value = next
    if (!next.some(b => b.id === selectedId.value)) {
      selectedId.value = next[0]?.id ?? ''
    }
  })

  onNodeConfigure(node, () => {
    const restored = readInitialBoxes()
    boxes.value = restored
    if (!restored.some(b => b.id === selectedId.value)) {
      selectedId.value = restored[0]?.id ?? ''
    }
  })

  watch(sourceImageUrl, (url, prev) => {
    if (url !== prev) {
      cachedImg = null
      cachedUrl = null
    }
    if (!url) return
    if (!boxes.value.length) {
      void getSourceImage(url).then((img) => {
        if (boxes.value.length) return
        const created = defaultCropBox(img.naturalWidth, img.naturalHeight)
        boxes.value = [created]
        selectedId.value = created.id
      }).catch(() => { /* ignore load errors; UI shows empty */ })
      return
    }
    if (boxes.value.some(b => b.width > 0 && b.height > 0)) {
      requestRecompute()
    }
  }, { immediate: true })

  return {
    sourceImageUrl,
    boxes,
    selectedId,
    selectedBox,
    bounds,
    setBounds,
    selectBox,
    addBox,
    removeSelected,
    canAdd,
    canRemove,
    computing,
    requestRecompute,
  }
}
