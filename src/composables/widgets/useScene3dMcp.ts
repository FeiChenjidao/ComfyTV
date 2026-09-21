import type { ComputedRef, Ref } from 'vue'

import type { Asset } from '@/api/schemas'
import { useAssetStore } from '@/stores/assetStore'
import { readWidgetStr, writeWidget } from '@/utils/widget'
import { isSceneModelUrl } from '@/widgets/three/modelFormats'
import {
  SCENE_CHANNELS,
  type SceneChannel
} from '@/widgets/three/scene3d/capture/channelRender'
import { idMatteOrder } from '@/widgets/three/scene3d/idMatte'
import {
  applySceneOps,
  type SceneOpResult
} from '@/widgets/three/scene3d/mcpOps'
import type { Scene3dCharacterManifestEntry } from '@/widgets/three/scene3d/scene3dAssets'
import {
  getCharacterClipNames,
  getCustomModelClipNames
} from '@/widgets/three/scene3d/scene3dAssets'

import {
  CHANNEL_WIDGET,
  HEIGHT_WIDGET,
  IMAGES_WIDGET,
  WIDTH_WIDGET,
  type Scene3dStageCore
} from './scene3dStageCore'
import type { useScene3dCapture } from './useScene3dCapture'

interface Scene3dMcpDeps {
  availableModels: Ref<Scene3dCharacterManifestEntry[]>
  modelAssets: ComputedRef<Asset[]>
  hasRecordableDuration: ComputedRef<boolean>
  capture: ReturnType<typeof useScene3dCapture>
}

interface OutputPatch {
  channel?: string
  width?: number
  height?: number
  layers?: {
    characters?: boolean
    props?: boolean
    room?: boolean
    floor?: boolean
  }
}

export function useScene3dMcp(core: Scene3dStageCore, deps: Scene3dMcpDeps) {
  const { node, state, cameraPresets } = core
  const { availableModels, modelAssets, hasRecordableDuration, capture } = deps
  const assetStore = useAssetStore()

  async function mcpApplyOps(ops: any[]): Promise<SceneOpResult[]> {
    if (Array.isArray(ops)
        && ops.some((op) => op?.op === 'add_model' && op.asset_id != null)) {
      await assetStore.refresh()
    }
    const { next, results } = applySceneOps(state.value, ops, {
      resolveModel: (assetId, url) => {
        if (url) return { url, name: url.split('filename=')[1] ?? 'model' }
        if (assetId == null) return null
        const asset = assetStore.byId(assetId)
        if (!asset || asset.media_type !== 'model'
            || !isSceneModelUrl(asset.payload_url)) {
          return null
        }
        return { url: asset.payload_url, name: asset.name || `asset ${assetId}` }
      },
      resolvePresetFile: (presetId) =>
        cameraPresets.value.find((preset) => preset.id === presetId)?.file ?? null,
      editorPose: () => core.viewport?.getEditorCameraPose(),
    })
    core.commit(next)
    return results
  }

  function mcpConfigureOutput(patch: OutputPatch): void {
    if (patch.channel && (SCENE_CHANNELS as readonly string[]).includes(patch.channel)) {
      capture.channel.value = patch.channel as SceneChannel
      writeWidget(node, CHANNEL_WIDGET, patch.channel, { fireCallback: false })
      core.viewport?.setPreviewChannel(capture.channel.value)
    }
    if (Number.isFinite(patch.width)) {
      capture.outputWidth.value = Number(patch.width)
      writeWidget(node, WIDTH_WIDGET, capture.outputWidth.value, { fireCallback: false })
    }
    if (Number.isFinite(patch.height)) {
      capture.outputHeight.value = Number(patch.height)
      writeWidget(node, HEIGHT_WIDGET, capture.outputHeight.value, { fireCallback: false })
    }
    if (patch.layers && typeof patch.layers === 'object') {
      core.viewport?.setCaptureLayers({
        ...(patch.layers.characters === false ? { characters: false } : {}),
        ...(patch.layers.props === false ? { props: false } : {}),
        ...(patch.layers.room === false ? { room: false } : {}),
        ...(patch.layers.floor === false ? { floor: false } : {})
      })
    } else {
      core.viewport?.setCaptureLayers(null)
    }
  }

  function idLegend(): { id_legend?: ReturnType<typeof idMatteOrder> } {
    return capture.channel.value === 'id'
      ? { id_legend: idMatteOrder(state.value) }
      : {}
  }

  function installHostApi(): void {
    const hostApi = ((node as any).__comfytvStageApi ??= {})
    hostApi.scene3d = {
      getState: () => JSON.parse(JSON.stringify(state.value)),
      resources: () => JSON.parse(JSON.stringify({
        characters: availableModels.value,
        camera_presets: cameraPresets.value.map((preset) => ({
          id: preset.id, name: (preset as any).name ?? preset.id,
        })),
        model_assets: modelAssets.value.map((asset) => ({
          id: asset.id, name: asset.name,
        })),
        channels: SCENE_CHANNELS,
      })),
      applyOps: mcpApplyOps,
      configureOutput: mcpConfigureOutput,
      clipNames: async (id: string): Promise<string[]> => {
        const character = state.value.characters.find((entry) => entry.id === id)
        if (character) return await getCharacterClipNames(character.model)
        const model = state.value.models.find((entry) => entry.id === id)
        if (model) return await getCustomModelClipNames(model.url)
        throw new Error(`'${id}' is not a character or model`)
      },
      isBusy: () => capture.capturing.value || capture.recording.value,
      hasRecordableDuration: () => hasRecordableDuration.value,
      capture: async () => {
        const before = capture.capturedImageUrl.value
        try {
          await capture.capture()
        } finally {
          core.viewport?.setCaptureLayers(null)
        }
        if (capture.capturedImageUrl.value === before) {
          throw new Error('capture produced no output — see the ComfyTV tab for details')
        }
        return {
          image: capture.capturedImageUrl.value,
          images: readWidgetStr(node, IMAGES_WIDGET, ''),
          ...idLegend(),
        }
      },
      record: async () => {
        if (!capture.recordingSupported) {
          throw new Error('video recording is not supported in this browser tab')
        }
        if (!hasRecordableDuration.value) {
          throw new Error(
            'nothing to record — bind a camera preset, add an animated '
            + 'character/model, or set a frame_count via scene_edit set_output')
        }
        const before = capture.capturedVideoUrl.value
        try {
          await capture.record()
        } finally {
          core.viewport?.setCaptureLayers(null)
        }
        if (capture.capturedVideoUrl.value === before) {
          throw new Error('record produced no output — see the ComfyTV tab for details')
        }
        return {
          video: capture.capturedVideoUrl.value,
          ...idLegend(),
        }
      },
    }
  }

  function uninstallHostApi(): void {
    const api = (node as any).__comfytvStageApi
    if (api?.scene3d) delete api.scene3d
  }

  return { installHostApi, uninstallHostApi }
}
