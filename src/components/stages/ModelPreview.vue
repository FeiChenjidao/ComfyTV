<template>
  <div
    ref="hostEl"
    data-capture-wheel="true"
    tabindex="-1"
    @pointerenter="onHostEnter"
    class="ctv:relative ctv:w-full ctv:h-full ctv:min-h-[220px] ctv:overflow-hidden ctv:rounded-sm ctv:bg-black ctv:touch-none ctv:outline-none"
  >
    <div
      v-if="loading || loadError"
      class="ctv:absolute ctv:inset-0 ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:gap-1.5
             ctv:text-white/50 ctv:pointer-events-none"
    >
      <i :class="['pi', loadError ? 'pi-exclamation-triangle' : 'pi-box', 'ctv:text-[28px] ctv:opacity-60']" />
      <div class="ctv:text-2xs ctv:text-center ctv:px-3">
        {{ loadError ? $t('modelPreview.loadFailed') : $t('modelPreview.loading') }}
      </div>
    </div>

    <ModelPreviewControls
      v-if="controls && !loading && !loadError && modelReady"
      :channel="activeChannel"
      :normal-mode="normalPreviewMode"
      :has-normal-map="hasNormalMap"
      :lighting="lightingMode"
      :pbr="pbr"
      :map-slots="mapSlots"
      :downloading-map="downloadingMap"
      :stats="viewerStats"
      :fullscreen="isFullscreen"
      @update:channel="onChannelChange"
      @update:normal-mode="onNormalModeChange"
      @update:lighting="onLightingChange"
      @update:pbr="onPbrChange"
      @reset-pbr="resetPbr"
      @map-file="onMapFile"
      @clear-map="onClearMap"
      @download-map="onDownloadMap"
      @reset-view="resetView"
      @toggle-fullscreen="toggleFullscreen"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import ModelPreviewControls from './ModelPreviewControls.vue'
import {
  DEFAULT_PREVIEW_PBR,
  type ModelViewerStats,
  type PreviewMapSlot,
  type PreviewPbrKey,
} from './modelPreviewTypes'
import {
  fetchModelBytes,
  urlFilename,
  useModelPreview,
  type ModelStats,
} from '@/composables/stages/useModelPreview'
import { buildPointCloud, classifyModelBytes, loadSpark } from '@/widgets/three/modelFormats'
import { exportModelObject, type ModelExportFormat } from '@/widgets/three/modelExporter'
import { exportSourceModel } from '@/widgets/three/sourceModelExport'
import { texturePng } from '@/widgets/three/modelTextures'
import { downloadBlob } from '@/utils/download'
import { app } from '@/lib/comfyApp'
import { guardOrbitControlsDragEnd } from '@/widgets/three/orbitControlsGuard'
import { RendererView } from '@/widgets/three/RendererView'
import { buildPrimitiveMesh, parsePrimitiveRecipe } from '@/widgets/three/primitiveGeometry'
import { loadCustomModelAssets } from '@/widgets/three/scene3d/scene3dAssets'
import {
  applyViewChannel,
  type NormalPreviewMode,
  type ViewChannel,
} from '@/widgets/three/channelShading'
import {
  applyPreviewMaterialOverrides,
  clearPreviewMaterialClones,
  loadTextureFromFile,
  replaceSceneLights,
  type PreviewLighting,
} from '@/widgets/three/previewShading'
import {
  MATERIAL_COLOR_MAP_KEYS,
  MATERIAL_MAP_KEYS,
  type MaterialMapKey,
  type MaterialParams,
} from '@/widgets/material/types'

const props = withDefaults(defineProps<{
  src: string
  pickable?: boolean
  partMaterials?: Record<string, MaterialParams | null>
  selectedPart?: string | null
  channel?: ViewChannel
  /** Show view-mode / lighting / texture / PBR overlay controls. */
  controls?: boolean
}>(), {
  controls: false,
})

const emit = defineEmits<{
  (e: 'view-changed'): void
  (e: 'parts-changed', keys: string[]): void
  (e: 'part-pick', key: string | null): void
  (e: 'model-stats', stats: ModelStats): void
  (e: 'part-materials-ready'): void
}>()

const hostEl = ref<HTMLDivElement | null>(null)
const modelReady = ref(false)

const internalChannel = ref<ViewChannel>('material')
const normalPreviewMode = ref<NormalPreviewMode>('geometry')
const lightingMode = ref<PreviewLighting>('default')
const pbr = reactive({ ...DEFAULT_PREVIEW_PBR })
const mapSlots = ref<PreviewMapSlot[]>(emptyMapSlots())
const viewerStats = ref<ModelViewerStats>({
  vertices: 0,
  triangles: 0,
  meshes: 0,
  materials: 0,
  size: [0, 0, 0],
})
const isFullscreen = ref(false)

const overrideTextures = new Map<MaterialMapKey, THREE.Texture>()
const embeddedTextures = new Map<MaterialMapKey, THREE.Texture>()
const downloadingMap = ref(false)
const overrideMapMeta = new Map<MaterialMapKey, { fileName: string; previewUrl: string }>()
let embeddedMapSlots: PreviewMapSlot[] = emptyMapSlots()

const activeChannel = computed<ViewChannel>(() =>
  props.controls ? internalChannel.value : (props.channel ?? 'material'))
const hasNormalMap = computed(() =>
  mapSlots.value.some((slot) => slot.key === 'normalMap' && slot.source !== 'empty'))

const previewProps = reactive({
  pickable: props.pickable,
  partMaterials: props.partMaterials,
  selectedPart: props.selectedPart,
  channel: activeChannel.value as ViewChannel | undefined,
})

watch(
  () => [props.pickable, props.partMaterials, props.selectedPart, activeChannel.value] as const,
  () => {
    previewProps.pickable = props.pickable
    previewProps.partMaterials = props.partMaterials
    previewProps.selectedPart = props.selectedPart
    previewProps.channel = activeChannel.value
  },
  { deep: true },
)

let view: RendererView | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controlsOrbit: OrbitControls | null = null
let disposeDragGuard: (() => void) | null = null
let modelRoot: THREE.Object3D | null = null
let modelDispose: (() => void) | null = null
let sparkRenderer: THREE.Object3D | null = null
let animationId: number | null = null

const previewEmit: typeof emit = ((event: any, ...args: any[]) => {
  if (event === 'part-materials-ready') {
    if (modelRoot && activeChannel.value === 'material') {
      refreshEmbeddedMaps()
      applyMaterialAdjustments()
    }
    emit('view-changed')
    return
  }
  if (event === 'model-stats') {
    const stats = args[0] as ModelStats
    viewerStats.value = { ...viewerStats.value, ...stats }
  }
  return (emit as any)(event, ...args)
}) as typeof emit

const mp = useModelPreview(previewProps, previewEmit, {
  getCamera: () => camera,
  getModelRoot: () => modelRoot,
  getCanvasRect: () => view?.canvas.getBoundingClientRect() ?? null,
  renderThumbnail: (size) => {
    if (!view || !scene || !camera) return null
    const captureCamera = camera.clone()
    captureCamera.aspect = 1
    captureCamera.updateProjectionMatrix()
    return view.renderToCanvas(scene, captureCamera, size, size)
  },
})

const { loading, loadError } = mp

function emptyMapSlots(): PreviewMapSlot[] {
  return MATERIAL_MAP_KEYS.map((key) => ({ key, previewUrl: null, source: 'empty', count: 0 }))
}

function texturePreviewUrl(texture: THREE.Texture): string | null {
  const image = texture.image as {
    currentSrc?: string
    src?: string
    width?: number
    height?: number
  } | null
  const direct = image?.currentSrc || image?.src
  if (direct) return direct
  if (!image?.width || !image?.height) return null
  try {
    const canvas = document.createElement('canvas')
    const maxSize = 256
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function refreshEmbeddedMaps(): void {
  embeddedTextures.clear()
  if (!modelRoot) {
    embeddedMapSlots = emptyMapSlots()
    syncMapSlots()
    return
  }
  const counts = new Map<MaterialMapKey, number>()
  const previews = new Map<MaterialMapKey, string>()
  modelRoot.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      for (const key of MATERIAL_MAP_KEYS) {
        const texture = (material as unknown as Record<MaterialMapKey, THREE.Texture | null>)[key]
        if (!texture) continue
        if (!embeddedTextures.has(key)) embeddedTextures.set(key, texture)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if (!previews.has(key)) {
          const preview = texturePreviewUrl(texture)
          if (preview) previews.set(key, preview)
        }
      }
    }
  })
  embeddedMapSlots = MATERIAL_MAP_KEYS.map((key) => ({
    key,
    previewUrl: previews.get(key) ?? null,
    source: counts.has(key) ? 'embedded' : 'empty',
    count: counts.get(key) ?? 0,
  }))
  syncMapSlots()
}

function syncMapSlots(): void {
  mapSlots.value = embeddedMapSlots.map((slot) => {
    const custom = overrideMapMeta.get(slot.key)
    return custom
      ? { ...slot, source: 'custom', previewUrl: custom.previewUrl, fileName: custom.fileName }
      : slot
  })
}

function refreshViewerMetadata(root: THREE.Object3D): void {
  const bounds = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  bounds.getSize(size)
  let meshes = 0
  const materials = new Set<string>()
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    meshes += 1
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of childMaterials) materials.add(material.uuid)
  })
  viewerStats.value = {
    ...viewerStats.value,
    meshes,
    materials: materials.size,
    size: [size.x, size.y, size.z],
  }
}

function syncLighting(): void {
  if (!scene) return
  replaceSceneLights(scene, lightingMode.value)
}

function applyMaterialAdjustments(): void {
  if (!modelRoot) return
  const maps = {} as Record<MaterialMapKey, THREE.Texture | null>
  for (const key of MATERIAL_MAP_KEYS) maps[key] = overrideTextures.get(key) ?? null
  applyPreviewMaterialOverrides(modelRoot, {
    maps,
    scalars: { ...pbr },
    multiply: true,
  })
}

function applyShading(): void {
  if (!modelRoot) return
  const ch = activeChannel.value
  mp.clearHighlight()
  applyViewChannel(modelRoot, ch, { normalMode: normalPreviewMode.value })
  if (ch === 'material') {
    mp.applyPartMaterials(true)
    refreshEmbeddedMaps()
    applyMaterialAdjustments()
    if (props.selectedPart) mp.setHighlight(props.selectedPart)
  }
  emit('view-changed')
}

function onChannelChange(ch: ViewChannel): void {
  internalChannel.value = ch
  applyShading()
}

function onNormalModeChange(mode: NormalPreviewMode): void {
  if (mode === 'texture' && !hasNormalMap.value) return
  normalPreviewMode.value = mode
  if (activeChannel.value === 'normal') applyShading()
}

function onLightingChange(mode: PreviewLighting): void {
  lightingMode.value = mode
  syncLighting()
  emit('view-changed')
}

function onPbrChange(key: PreviewPbrKey, value: number): void {
  pbr[key] = value
  if (modelRoot && activeChannel.value === 'material') {
    applyMaterialAdjustments()
    emit('view-changed')
  }
}

function resetPbr(): void {
  Object.assign(pbr, DEFAULT_PREVIEW_PBR)
  if (modelRoot && activeChannel.value === 'material') {
    applyMaterialAdjustments()
    emit('view-changed')
  }
}

async function onMapFile(key: MaterialMapKey, file: File): Promise<void> {
  try {
    const colorSpace = MATERIAL_COLOR_MAP_KEYS.has(key)
      ? THREE.SRGBColorSpace
      : THREE.NoColorSpace
    const texture = await loadTextureFromFile(file, colorSpace)
    overrideTextures.get(key)?.dispose()
    overrideTextures.set(key, texture)
    const previous = overrideMapMeta.get(key)
    if (previous) URL.revokeObjectURL(previous.previewUrl)
    overrideMapMeta.set(key, {
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
    })
    syncMapSlots()
    if (internalChannel.value !== 'material') internalChannel.value = 'material'
    applyShading()
  } catch (e) {
    console.error('[ComfyTV/ModelPreview] material map load failed', key, e)
  }
}

function onClearMap(key: MaterialMapKey): void {
  overrideTextures.get(key)?.dispose()
  overrideTextures.delete(key)
  const meta = overrideMapMeta.get(key)
  if (meta) URL.revokeObjectURL(meta.previewUrl)
  overrideMapMeta.delete(key)
  syncMapSlots()
  if (key === 'normalMap' && !hasNormalMap.value) normalPreviewMode.value = 'geometry'
  applyShading()
}

async function onDownloadMap(key: MaterialMapKey): Promise<void> {
  const texture = overrideTextures.get(key) ?? embeddedTextures.get(key)
  if (!texture || downloadingMap.value) return
  downloadingMap.value = true
  try {
    const channel = key === 'roughnessMap' || key === 'alphaMap' ? 1 : key === 'metalnessMap' ? 2 : undefined
    const bytes = await texturePng(texture, channel)
    const sourceName = overrideMapMeta.get(key)?.fileName ?? urlFilename(props.src)
    const name = sourceName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'model'
    downloadBlob(`${name}_${key}.png`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  } catch (e) {
    console.error('[ComfyTV/ModelPreview] texture download failed', key, e)
    ;(app as any)?.extensionManager?.toast?.add?.({
      severity: 'error', summary: e instanceof Error ? e.message : String(e), life: 4000,
    })
  } finally {
    downloadingMap.value = false
  }
}

function resetView(): void {
  if (!modelRoot) return
  frameModel(modelRoot)
  emit('view-changed')
}

async function toggleFullscreen(): Promise<void> {
  if (!hostEl.value) return
  try {
    if (document.fullscreenElement === hostEl.value) await document.exitFullscreen()
    else await hostEl.value.requestFullscreen()
  } catch (e) {
    console.warn('[ComfyTV/ModelPreview] fullscreen request failed', e)
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === hostEl.value
  syncSize()
}

function clearMapOverrides(): void {
  for (const texture of overrideTextures.values()) texture.dispose()
  overrideTextures.clear()
  for (const meta of overrideMapMeta.values()) URL.revokeObjectURL(meta.previewUrl)
  overrideMapMeta.clear()
  embeddedMapSlots = emptyMapSlots()
  syncMapSlots()
}

async function ensureSparkRenderer(): Promise<void> {
  if (sparkRenderer || !scene || !view) return
  const { SparkRenderer } = await loadSpark()
  if (sparkRenderer || !scene || !view) return
  sparkRenderer = new SparkRenderer({ renderer: view.renderer })
  scene.add(sparkRenderer)
}

function disposeModelRoot(): void {
  embeddedTextures.clear()
  if (modelRoot) {
    applyViewChannel(modelRoot, 'material')
    clearPreviewMaterialClones(modelRoot)
    if (scene) scene.remove(modelRoot)
  }
  modelRoot = null
  modelDispose?.()
  modelDispose = null
  modelReady.value = false
  mp.disposeParts()
}

function onHostEnter(): void {
  hostEl.value?.focus({ preventScroll: true })
}

function syncSize(): void {
  if (!view || !hostEl.value || !camera) return
  const w = hostEl.value.clientWidth || 300
  const h = hostEl.value.clientHeight || 220
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  view.setSize(w * scale, h * scale)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  if (scene) view.renderScene(scene, camera)
}

function frameModel(root: THREE.Object3D): void {
  if (!camera || !controlsOrbit) return
  const bounds = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  bounds.getCenter(center)
  bounds.getSize(size)
  let maxDim = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    center.set(0, 0, 0)
    maxDim = 2
  }
  const dist = maxDim * 1.8
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7)
  camera.near = Math.max(maxDim / 1000, 0.001)
  camera.far = Math.max(maxDim * 100, 100)
  camera.updateProjectionMatrix()
  controlsOrbit.target.copy(center)
  controlsOrbit.update()
}

interface LoadedModel {
  root: THREE.Object3D
  dispose: (() => void) | null
}

async function loadModelObject(url: string): Promise<LoadedModel> {
  const prim = parsePrimitiveRecipe(url)
  if (prim) {
    const group = new THREE.Group()
    group.add(buildPrimitiveMesh(prim.kind, prim.params))
    return { root: group, dispose: null }
  }

  let bytes: ArrayBuffer | null = null
  const fetchBytes = async () => (bytes ??= await fetchModelBytes(url))
  const kind = await classifyModelBytes(url, fetchBytes)

  if (kind === 'splat') {
    const [{ SplatMesh }] = await Promise.all([loadSpark(), ensureSparkRenderer()])
    const splat = new SplatMesh({
      fileBytes: await fetchBytes(),
      fileName: urlFilename(url),
    })
    await splat.initialized
    splat.quaternion.set(1, 0, 0, 0)
    const group = new THREE.Group()
    group.add(splat)
    return { root: group, dispose: () => splat.dispose() }
  }

  if (kind === 'pointcloud') {
    const group = buildPointCloud(await fetchBytes())
    return {
      root: group,
      dispose: () => {
        group.traverse((child) => {
          if (child instanceof THREE.Points) {
            child.geometry.dispose()
            const mat = child.material
            for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose()
          }
        })
      },
    }
  }

  const assets = await loadCustomModelAssets(url)
  return { root: cloneSkinned(assets.template), dispose: null }
}

async function loadModel(url: string): Promise<void> {
  const mySeq = mp.beginLoad()
  disposeModelRoot()
  if (!url) {
    loading.value = false
    loadError.value = false
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const loaded = await loadModelObject(url)
    if (mp.isStale(mySeq) || !scene) {
      loaded.dispose?.()
      return
    }
    modelRoot = loaded.root
    modelDispose = loaded.dispose
    scene.add(loaded.root)
    mp.registerParts(loaded.root)
    refreshViewerMetadata(loaded.root)
    applyShading()
    frameModel(loaded.root)
    loading.value = false
    modelReady.value = true
    mp.scheduleThumbnailPersist(url)
  } catch (e) {
    console.error('[ComfyTV/ModelPreview] failed to load model', url, e)
    if (mp.isStale(mySeq)) return
    loading.value = false
    loadError.value = true
    modelReady.value = false
  }
}

function animate(): void {
  animationId = requestAnimationFrame(animate)
  if (!view || !scene || !camera) return
  controlsOrbit?.update()
  view.renderScene(scene, camera)
}

onMounted(() => {
  if (!hostEl.value) return

  scene = new THREE.Scene()
  syncLighting()

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  camera.position.set(2, 1.5, 2)

  view = new RendererView(hostEl.value)
  view.state.clearColor = new THREE.Color(0x141418)
  view.state.clearAlpha = 1

  controlsOrbit = new OrbitControls(camera, view.canvas)
  controlsOrbit.enableDamping = true
  disposeDragGuard = guardOrbitControlsDragEnd(controlsOrbit, view.canvas)
  controlsOrbit.addEventListener('end', () => emit('view-changed'))

  view.canvas.addEventListener('pointerdown', mp.onPickDown)
  view.canvas.addEventListener('pointerup', mp.onPickUp)
  document.addEventListener('fullscreenchange', onFullscreenChange)

  syncSize()
  view.observeResize(hostEl.value, syncSize)
  animate()

  void loadModel(props.src)
})

watch(() => props.src, (url) => {
  clearMapOverrides()
  internalChannel.value = 'material'
  normalPreviewMode.value = 'geometry'
  Object.assign(pbr, DEFAULT_PREVIEW_PBR)
  viewerStats.value = {
    vertices: 0,
    triangles: 0,
    meshes: 0,
    materials: 0,
    size: [0, 0, 0],
  }
  void loadModel(url || '')
})

watch(() => props.channel, () => {
  if (props.controls) return
  applyShading()
})

watch(() => props.partMaterials, () => {
  // Materials often arrive after the model finishes loading (upstream Material
  // stage hydrates a tick later). Re-run full shading so bindings + maps apply.
  if (!modelRoot || activeChannel.value !== 'material') return
  applyShading()
}, { deep: true })

onBeforeUnmount(() => {
  mp.teardown()
  if (animationId != null) cancelAnimationFrame(animationId)
  animationId = null
  view?.canvas.removeEventListener('pointerdown', mp.onPickDown)
  view?.canvas.removeEventListener('pointerup', mp.onPickUp)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  disposeDragGuard?.()
  disposeDragGuard = null
  controlsOrbit?.dispose()
  controlsOrbit = null
  disposeModelRoot()
  clearMapOverrides()
  if (sparkRenderer) {
    scene?.remove(sparkRenderer)
    ;(sparkRenderer as unknown as { dispose?: () => void }).dispose?.()
    sparkRenderer = null
  }
  view?.dispose()
  view = null
  scene = null
  camera = null
})

defineExpose({
  async exportModel(format: ModelExportFormat, baseName = 'model'): Promise<void> {
    if (await exportSourceModel(props.src, format)) return
    if (!modelRoot || !modelReady.value) throw new Error('No model is ready to export')
    const restoreHighlight = mp.suspendHighlight()
    applyViewChannel(modelRoot, 'material')
    try {
      const exportRoot = cloneSkinned(modelRoot)
      exportRoot.animations = [...(modelRoot.animations ?? [])]
      await exportModelObject(exportRoot, format, baseName)
    } finally {
      applyShading()
      restoreHighlight()
    }
  },
  cameraState(): { position: number[]; target: number[]; fov: number } | null {
    if (!camera || !controlsOrbit) return null
    return {
      position: camera.position.toArray(),
      target: controlsOrbit.target.toArray(),
      fov: camera.fov,
    }
  },
  captureCanvas(width: number, height: number): HTMLCanvasElement | null {
    if (!view || !scene || !camera) return null
    const captureCamera = camera.clone()
    captureCamera.aspect = width / height
    captureCamera.updateProjectionMatrix()
    const restoreHighlight = mp.suspendHighlight()
    try {
      return view.renderToCanvas(scene, captureCamera, width, height)
    } finally {
      restoreHighlight()
    }
  },
})
</script>
