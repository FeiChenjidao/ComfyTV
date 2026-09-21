import { computed, type Ref } from 'vue'

import { i18n } from '@/i18n'
import type { LGraphNode } from '@/lib/comfyApp'
import { app } from '@/lib/comfyApp'
import { useAssetStore } from '@/stores/assetStore'
import type { CameraPresetManifestEntry } from '@/widgets/three/load3d/cameraPresetAssets'
import { isSceneModelUrl } from '@/widgets/three/modelFormats'
import type {
  Scene3dGizmoMode,
  Scene3dViewport
} from '@/widgets/three/scene3d/Scene3dViewport'
import type {
  Scene3DState,
  SceneCameraEntry,
  SceneCharacterEntry,
  SceneLightEntry,
  SceneModelEntry,
  ScenePrimitiveEntry
} from '@/widgets/three/scene3d/types'

export const SCENE_WIDGET = 'scene_state'
export const CHANNEL_WIDGET = 'channel'
export const WIDTH_WIDGET = 'width'
export const HEIGHT_WIDGET = 'height'
export const IMAGE_WIDGET = 'captured_image'
export const IMAGES_WIDGET = 'captured_images'
export const VIDEO_WIDGET = 'captured_video'
export const PROP_KEY = 'comfytv_scene3d_editor'

export interface EditorProps {
  selectedId?: string | null
  pipCameraId?: string | null
  gizmoMode?: Scene3dGizmoMode
  timelinePlaying?: boolean
}

export interface Scene3dStageCore {
  node: LGraphNode
  state: Ref<Scene3DState>
  selectedId: Ref<string | null>
  readonly viewport: Scene3dViewport | null
  cameraPresets: Ref<CameraPresetManifestEntry[]>
  timelineDataVersion: Ref<number>
  commit(next: Scene3DState, mergeKey?: string): void
  readEditorProps(): EditorProps
  writeEditorProps(patch: EditorProps): void
  setPipCamera(id: string | null): void
  setLookThrough(id: string | null): void
}

export function tr(key: string): string {
  return i18n.global.t(key)
}

export function toastError(detail: string): void {
  ;(app as any)?.extensionManager?.toast?.add?.({
    severity: 'error',
    summary: 'ComfyTV',
    detail,
    life: 5000
  })
}

export function firstSceneId(scene: Scene3DState): string | null {
  return (
    scene.characters[0]?.id ??
    scene.primitives[0]?.id ??
    scene.models[0]?.id ??
    scene.lights[0]?.id ??
    scene.cameras[0]?.id ??
    null
  )
}

export function idExists(scene: Scene3DState, id: string | null): boolean {
  if (!id) return false
  return (
    scene.characters.some((entry) => entry.id === id) ||
    scene.primitives.some((entry) => entry.id === id) ||
    scene.models.some((entry) => entry.id === id) ||
    scene.lights.some((entry) => entry.id === id) ||
    scene.cameras.some((entry) => entry.id === id)
  )
}

export function allIds(scene: Scene3DState): string[] {
  return [
    ...scene.characters.map((entry) => entry.id),
    ...scene.primitives.map((entry) => entry.id),
    ...scene.models.map((entry) => entry.id),
    ...scene.lights.map((entry) => entry.id),
    ...scene.cameras.map((entry) => entry.id),
    ...scene.shots.map((entry) => entry.id),
    ...scene.promptTrack.map((entry) => entry.id)
  ]
}

export function findLabelEntry(
  scene: Scene3DState,
  id: string
): { name?: string; hidden?: boolean } | undefined {
  return (
    scene.characters.find((entry) => entry.id === id) ??
    scene.primitives.find((entry) => entry.id === id) ??
    scene.models.find((entry) => entry.id === id) ??
    scene.lights.find((entry) => entry.id === id) ??
    scene.cameras.find((entry) => entry.id === id) ??
    scene.shots.find((entry) => entry.id === id)
  )
}

export function patchMergeKey(patch: Record<string, unknown>): string {
  return Object.keys(patch).sort().join(',')
}

export function useScene3dSelection(
  state: Ref<Scene3DState>,
  selectedId: Ref<string | null>
) {
  const assetStore = useAssetStore()
  const selectedCharacter = computed<SceneCharacterEntry | null>(
    () =>
      state.value.characters.find(
        (character) => character.id === selectedId.value
      ) ?? null
  )
  const selectedPrimitive = computed<ScenePrimitiveEntry | null>(
    () =>
      state.value.primitives.find(
        (primitive) => primitive.id === selectedId.value
      ) ?? null
  )
  const selectedLight = computed<SceneLightEntry | null>(
    () =>
      state.value.lights.find((light) => light.id === selectedId.value) ?? null
  )
  const selectedModel = computed<SceneModelEntry | null>(
    () =>
      state.value.models.find((model) => model.id === selectedId.value) ?? null
  )
  const modelAssets = computed(() =>
    assetStore.assets.filter(
      (asset) => asset.media_type === 'model' && isSceneModelUrl(asset.payload_url)
    )
  )
  const selectedCamera = computed<SceneCameraEntry | null>(
    () =>
      state.value.cameras.find((camera) => camera.id === selectedId.value) ??
      null
  )
  const selectedShot = computed(
    () =>
      state.value.shots.find((shot) => shot.id === selectedId.value) ?? null
  )
  const selectedPrompt = computed(
    () =>
      state.value.promptTrack.find(
        (strip) => strip.id === selectedId.value
      ) ?? null
  )
  const outputCameraId = computed(() => state.value.output.cameraId)
  const hasRecordableDuration = computed(
    () =>
      state.value.shots.length > 0 ||
      state.value.output.frameCount > 0 ||
      state.value.cameras.some((camera) => camera.preset !== null) ||
      state.value.characters.length > 0 ||
      state.value.models.some((model) => model.animation.clip !== '')
  )
  return {
    selectedCharacter,
    selectedPrimitive,
    selectedLight,
    selectedModel,
    modelAssets,
    selectedCamera,
    selectedShot,
    selectedPrompt,
    outputCameraId,
    hasRecordableDuration
  }
}
