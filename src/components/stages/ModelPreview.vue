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
      :lighting="lightingMode"
      :metalness="metalness"
      :roughness="roughness"
      :has-texture="!!overrideTexture"
      @update:channel="onChannelChange"
      @update:lighting="onLightingChange"
      @update:metalness="onMetalnessChange"
      @update:roughness="onRoughnessChange"
      @texture-file="onTextureFile"
      @clear-texture="onClearTexture"
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
  fetchModelBytes,
  urlFilename,
  useModelPreview,
  type ModelStats,
} from '@/composables/stages/useModelPreview'
import { buildPointCloud, classifyModelBytes, loadSpark } from '@/widgets/three/modelFormats'
import { guardOrbitControlsDragEnd } from '@/widgets/three/orbitControlsGuard'
import { RendererView } from '@/widgets/three/RendererView'
import { buildPrimitiveMesh, parsePrimitiveRecipe } from '@/widgets/three/primitiveGeometry'
import { loadCustomModelAssets } from '@/widgets/three/scene3d/scene3dAssets'
import { applyViewChannel, type ViewChannel } from '@/widgets/three/channelShading'
import {
  applyPreviewMaterialOverrides,
  loadTextureFromFile,
  replaceSceneLights,
  type PreviewLighting,
} from '@/widgets/three/previewShading'
import type { MaterialParams } from '@/widgets/material/types'

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
const lightingMode = ref<PreviewLighting>('default')
/** Multiplicative factors over the active material (1 = leave unchanged). */
const metalness = ref(1)
const roughness = ref(1)
const overrideTexture = ref<THREE.Texture | null>(null)

const activeChannel = computed<ViewChannel>(() =>
  props.controls ? internalChannel.value : (props.channel ?? 'material'))

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
    // Maps finished loading after applyShading cloned the pre-map material —
    // re-apply × metalness/roughness onto the freshly rebound meshes.
    if (modelRoot && activeChannel.value === 'material') applyPbrFactors()
    emit('view-changed')
    return
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

function syncLighting(): void {
  if (!scene) return
  replaceSceneLights(scene, lightingMode.value)
}

function applyPbrFactors(map?: THREE.Texture | null): void {
  if (!modelRoot) return
  const overrides: Parameters<typeof applyPreviewMaterialOverrides>[1] = {
    metalness: metalness.value,
    roughness: roughness.value,
    multiply: true,
  }
  if (map !== undefined) overrides.map = map
  else if (overrideTexture.value) overrides.map = overrideTexture.value
  applyPreviewMaterialOverrides(modelRoot, overrides)
}

function applyShading(): void {
  if (!modelRoot) return
  const ch = activeChannel.value
  mp.clearHighlight()
  applyViewChannel(modelRoot, ch)
  if (ch === 'material') {
    mp.applyPartMaterials(true)
    applyPbrFactors()
    if (props.selectedPart) mp.setHighlight(props.selectedPart)
  }
  emit('view-changed')
}

function onChannelChange(ch: ViewChannel): void {
  internalChannel.value = ch
  applyShading()
}

function onLightingChange(mode: PreviewLighting): void {
  lightingMode.value = mode
  syncLighting()
  emit('view-changed')
}

function onMetalnessChange(v: number): void {
  metalness.value = v
  if (modelRoot && activeChannel.value === 'material') {
    applyPbrFactors()
    emit('view-changed')
  }
}

function onRoughnessChange(v: number): void {
  roughness.value = v
  if (modelRoot && activeChannel.value === 'material') {
    applyPbrFactors()
    emit('view-changed')
  }
}

async function onTextureFile(file: File): Promise<void> {
  try {
    const tex = await loadTextureFromFile(file)
    overrideTexture.value?.dispose()
    overrideTexture.value = tex
    if (internalChannel.value !== 'material') internalChannel.value = 'material'
    applyShading()
  } catch (e) {
    console.error('[ComfyTV/ModelPreview] texture load failed', e)
  }
}

function onClearTexture(): void {
  overrideTexture.value?.dispose()
  overrideTexture.value = null
  applyShading()
}

async function ensureSparkRenderer(): Promise<void> {
  if (sparkRenderer || !scene || !view) return
  const { SparkRenderer } = await loadSpark()
  if (sparkRenderer || !scene || !view) return
  sparkRenderer = new SparkRenderer({ renderer: view.renderer })
  scene.add(sparkRenderer)
}

function disposeModelRoot(): void {
  if (modelRoot && scene) scene.remove(modelRoot)
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
    metalness.value = 1
    roughness.value = 1
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

  syncSize()
  view.observeResize(hostEl.value, syncSize)
  animate()

  void loadModel(props.src)
})

watch(() => props.src, (url) => {
  overrideTexture.value?.dispose()
  overrideTexture.value = null
  internalChannel.value = 'material'
  metalness.value = 1
  roughness.value = 1
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
  disposeDragGuard?.()
  disposeDragGuard = null
  controlsOrbit?.dispose()
  controlsOrbit = null
  overrideTexture.value?.dispose()
  overrideTexture.value = null
  disposeModelRoot()
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
