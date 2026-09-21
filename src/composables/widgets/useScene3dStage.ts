import { computed, ref, watch } from 'vue'

import { useChainCallback } from '@/composables/functional/useChainCallback'
import type { LGraphNode } from '@/lib/comfyApp'
import { useAssetStore } from '@/stores/assetStore'
import {
  bindWidgetCallback,
  onNodeConfigure,
  readWidgetStr,
  writeWidget
} from '@/utils/widget'
import { fetchCameraPresetManifest } from '@/widgets/three/load3d/cameraPresetAssets'
import type { CameraPresetManifestEntry } from '@/widgets/three/load3d/cameraPresetAssets'
import type {
  Scene3dGizmoMode,
  Scene3dViewport
} from '@/widgets/three/scene3d/Scene3dViewport'
import { Scene3dHistory } from '@/widgets/three/scene3d/Scene3dHistory'
import type { Scene3dHistorySnapshot } from '@/widgets/three/scene3d/Scene3dHistory'
import { createScene3dViewport } from '@/widgets/three/scene3d/createScene3dViewport'
import {
  fetchScene3dManifest,
  getCharacterClipNames,
  getCustomModelClipNames
} from '@/widgets/three/scene3d/scene3dAssets'
import type { Scene3dCharacterManifestEntry } from '@/widgets/three/scene3d/scene3dAssets'
import { normalizeSceneValue } from '@/widgets/three/scene3d/sceneValue'
import type { Scene3DState } from '@/widgets/three/scene3d/types'
import { cloneScene } from '@/widgets/three/scene3d/types'

import {
  PROP_KEY,
  SCENE_WIDGET,
  firstSceneId,
  idExists,
  toastError,
  tr,
  useScene3dSelection,
  type EditorProps,
  type Scene3dStageCore
} from './scene3dStageCore'
import { useScene3dCameras } from './useScene3dCameras'
import {
  useScene3dCapture,
  type Scene3dCaptureCallbacks
} from './useScene3dCapture'
import { useScene3dMcp } from './useScene3dMcp'
import { useScene3dObjects } from './useScene3dObjects'
import { useScene3dTimeline } from './useScene3dTimeline'

export type UseScene3dStageOptions = Scene3dCaptureCallbacks

export function useScene3dStage(
  node: LGraphNode,
  opts?: UseScene3dStageOptions
) {
  const assetStore = useAssetStore()
  let viewport: Scene3dViewport | null = null

  const state = ref<Scene3DState>(
    normalizeSceneValue(readWidgetStr(node, SCENE_WIDGET, '{}'))
  )
  const selectedId = ref<string | null>(null)
  const history = new Scene3dHistory()
  const historyVersion = ref(0)
  const canUndo = computed(() => {
    void historyVersion.value
    return history.canUndo()
  })
  const canRedo = computed(() => {
    void historyVersion.value
    return history.canRedo()
  })
  let lastCommitted: Scene3dHistorySnapshot = {
    json: JSON.stringify(state.value),
    selectedId: null
  }
  const availableModels = ref<Scene3dCharacterManifestEntry[]>([])
  const clipNamesForSelected = ref<string[]>([])
  const gizmoMode = ref<Scene3dGizmoMode>('none')
  const cameraPresets = ref<CameraPresetManifestEntry[]>([])
  const lookThroughId = ref<string | null>(null)
  const pipCameraId = ref<string | null>(null)
  const timelineDataVersion = ref(0)

  const selection = useScene3dSelection(state, selectedId)
  const { selectedCharacter, selectedModel } = selection

  const core: Scene3dStageCore = {
    node,
    state,
    selectedId,
    cameraPresets,
    timelineDataVersion,
    get viewport() {
      return viewport
    },
    commit,
    readEditorProps,
    writeEditorProps,
    setPipCamera,
    setLookThrough
  }
  const objects = useScene3dObjects(core)
  const cameras = useScene3dCameras(core)
  const timeline = useScene3dTimeline(core)
  const capture = useScene3dCapture(core, selection.hasRecordableDuration, opts)
  const mcp = useScene3dMcp(core, {
    availableModels,
    modelAssets: selection.modelAssets,
    hasRecordableDuration: selection.hasRecordableDuration,
    capture
  })

  function readEditorProps(): EditorProps {
    const stored = node?.properties?.[PROP_KEY]
    return stored && typeof stored === 'object' ? (stored as EditorProps) : {}
  }

  function writeEditorProps(patch: EditorProps): void {
    if (!node) return
    if (!node.properties) node.properties = {}
    node.properties[PROP_KEY] = { ...readEditorProps(), ...patch }
  }

  function loadFromNode(): void {
    state.value = normalizeSceneValue(readWidgetStr(node, SCENE_WIDGET, '{}'))
    const props = readEditorProps()
    selectedId.value = idExists(state.value, props.selectedId ?? null)
      ? (props.selectedId as string)
      : firstSceneId(state.value)
    const pip = props.pipCameraId ?? null
    pipCameraId.value =
      pip && state.value.cameras.some((entry) => entry.id === pip) ? pip : null
    gizmoMode.value = props.gizmoMode ?? 'none'
    capture.reloadFromNode()
  }

  function pushStateToViewport(): void {
    if (!viewport) return
    viewport
      .applyState(cloneScene(state.value), selectedId.value)
      .then(() => {
        timelineDataVersion.value += 1
      })
      .catch((error) => {
        console.error('[ComfyTV/scene3d] applyState failed', error)
      })
  }

  function syncViewportEditorState(target: Scene3dViewport): void {
    target.setGizmoMode(gizmoMode.value)
    target.setPreviewChannel(capture.channel.value)
    target.setPipCamera(pipCameraId.value)
    target.setTimelinePlayIntent(readEditorProps().timelinePlaying ?? true)
  }

  function initScene(container: HTMLElement): void {
    try {
      container.setAttribute('data-capture-wheel', 'true')
      if (!container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1')
      }
      container.style.outline = 'none'
      container.addEventListener('pointerenter', () => {
        container.focus?.({ preventScroll: true })
      })

      viewport = createScene3dViewport(
        container,
        {
          onTransformCommit: (id, transform) =>
            objects.commitTransform(id, transform),
          onSelectCharacter: (id) => selectObject(id),
          onLightChange: (id, patch) => objects.patchLightById(id, patch),
          onCameraOffsetCommit: (id, offset) =>
            cameras.updateCameraTuning(id, { positionOffset: { ...offset } }),
          onPathCommit: (id, label) => timeline.commitPathEdit(id, label)
        },
        {
          getDimensions: () => ({
            width: capture.outputWidth.value,
            height: capture.outputHeight.value
          })
        }
      )
      timeline.wireViewportEvents(viewport)
      ;(
        container as HTMLElement & { __scene3dViewport?: Scene3dViewport }
      ).__scene3dViewport = viewport
      syncViewportEditorState(viewport)
      pushStateToViewport()
      wireNodeMouseStatus(node)
      assetStore.ensureHydrated()
      assetStore.installWebSocketSync()
      void loadManifests()
    } catch (error) {
      console.error('[ComfyTV/scene3d] failed to initialize viewport', error)
      toastError(tr('scene3d.failedToInit'))
    }
  }

  function cleanup(): void {
    viewport?.remove()
    viewport = null
    mcp.uninstallHostApi()
  }

  const handleMouseEnter = (): void => {
    viewport?.updateStatusMouseOnScene(true)
    viewport?.refreshViewport()
  }

  const handleMouseLeave = (): void => {
    viewport?.updateStatusMouseOnScene(false)
  }

  function wireNodeMouseStatus(target: LGraphNode): void {
    const host = target as LGraphNode & {
      onMouseEnter?: (...args: unknown[]) => void
      onMouseLeave?: (...args: unknown[]) => void
    }
    host.onMouseEnter = useChainCallback(host.onMouseEnter, () => {
      viewport?.updateStatusMouseOnNode(true)
      viewport?.refreshViewport()
    })
    host.onMouseLeave = useChainCallback(host.onMouseLeave, () => {
      viewport?.updateStatusMouseOnNode(false)
    })
  }

  async function loadManifests(): Promise<void> {
    availableModels.value = await fetchScene3dManifest()
    cameraPresets.value = await fetchCameraPresetManifest()
    await refreshClipNames()
  }

  async function refreshClipNames(): Promise<void> {
    const characterModel = selectedCharacter.value?.model
    const modelUrl = selectedModel.value?.url
    try {
      if (characterModel) {
        clipNamesForSelected.value = await getCharacterClipNames(characterModel)
      } else if (modelUrl) {
        clipNamesForSelected.value = await getCustomModelClipNames(modelUrl)
      } else {
        clipNamesForSelected.value = []
      }
    } catch {
      clipNamesForSelected.value = []
    }
  }

  watch(
    () => [selectedCharacter.value?.model, selectedModel.value?.url],
    () => void refreshClipNames()
  )

  function commit(next: Scene3DState, mergeKey?: string): void {
    state.value = normalizeSceneValue(next)
    const json = JSON.stringify(state.value)
    if (json !== lastCommitted.json) {
      history.record(lastCommitted, mergeKey)
      historyVersion.value += 1
      lastCommitted = { json, selectedId: selectedId.value }
    }
    writeWidget(node, SCENE_WIDGET, json, {
      fireCallback: false
    })
    ensureLookThroughValid()
    ensurePipCameraValid()
    pushStateToViewport()
  }

  function undo(): void {
    const entry = history.undo(lastCommitted)
    if (!entry) return
    historyVersion.value += 1
    restoreSnapshot(entry)
  }

  function redo(): void {
    const entry = history.redo(lastCommitted)
    if (!entry) return
    historyVersion.value += 1
    restoreSnapshot(entry)
  }

  function restoreSnapshot(entry: Scene3dHistorySnapshot): void {
    state.value = normalizeSceneValue(entry.json)
    const restoredId = idExists(state.value, entry.selectedId)
      ? entry.selectedId
      : firstSceneId(state.value)
    selectedId.value = restoredId
    writeEditorProps({ selectedId: restoredId })
    lastCommitted = { json: JSON.stringify(state.value), selectedId: restoredId }
    writeWidget(node, SCENE_WIDGET, lastCommitted.json, {
      fireCallback: false
    })
    ensureLookThroughValid()
    ensurePipCameraValid()
    pushStateToViewport()
  }

  function resetHistoryBaseline(): void {
    history.clear()
    historyVersion.value += 1
    lastCommitted = {
      json: JSON.stringify(state.value),
      selectedId: selectedId.value
    }
  }

  function ensureLookThroughValid(): void {
    if (
      lookThroughId.value &&
      !state.value.cameras.some((entry) => entry.id === lookThroughId.value)
    ) {
      setLookThrough(null)
    }
  }

  function ensurePipCameraValid(): void {
    if (
      pipCameraId.value &&
      !state.value.cameras.some((entry) => entry.id === pipCameraId.value)
    ) {
      setPipCamera(null)
    }
  }

  onNodeConfigure(node, () => {
    loadFromNode()
    resetHistoryBaseline()
    setLookThrough(null)
    if (viewport) {
      syncViewportEditorState(viewport)
      viewport.refreshViewport()
      pushStateToViewport()
    }
  })

  bindWidgetCallback(node, SCENE_WIDGET, (value) => {
    if (!viewport) return
    state.value = normalizeSceneValue(value)
    if (!idExists(state.value, selectedId.value)) {
      selectedId.value = firstSceneId(state.value)
    }
    resetHistoryBaseline()
    ensureLookThroughValid()
    ensurePipCameraValid()
    pushStateToViewport()
  })

  function selectObject(id: string | null): void {
    if (id && state.value.cameras.some((camera) => camera.id === id)) {
      setPipCamera(id)
    }
    if (selectedId.value === id) return
    selectedId.value = id
    lastCommitted = { ...lastCommitted, selectedId: id }
    writeEditorProps({ selectedId: id })
    viewport?.setSelected(id)
  }

  function toggleSelectObject(id: string): void {
    selectObject(selectedId.value === id ? null : id)
  }

  function setPipCamera(id: string | null): void {
    if (pipCameraId.value === id) return
    pipCameraId.value = id
    writeEditorProps({ pipCameraId: id })
    viewport?.setPipCamera(id)
  }

  function setLookThrough(id: string | null): void {
    if (lookThroughId.value === id) return
    lookThroughId.value = id
    viewport?.setLookThroughCamera(id)
  }

  function toggleLookThrough(id: string): void {
    setLookThrough(lookThroughId.value === id ? null : id)
  }

  function setGizmoMode(mode: Scene3dGizmoMode): void {
    gizmoMode.value = mode
    writeEditorProps({ gizmoMode: mode })
    viewport?.setGizmoMode(mode)
  }

  mcp.installHostApi()
  loadFromNode()
  resetHistoryBaseline()

  const { wireViewportEvents: _wire, ...timelineApi } = timeline
  const { reloadFromNode: _reload, ...captureApi } = capture

  return {
    initScene,
    cleanup,
    handleMouseEnter,
    handleMouseLeave,
    state,
    selectedId,
    ...selection,
    availableModels,
    clipNamesForSelected,
    gizmoMode,
    undo,
    redo,
    canUndo,
    canRedo,
    selectObject,
    toggleSelectObject,
    setGizmoMode,
    cameraPresets,
    lookThroughId,
    toggleLookThrough,
    pipCameraId,
    setPipCamera,
    timelineDataVersion,
    ...objects,
    ...cameras,
    ...timelineApi,
    ...captureApi
  }
}
