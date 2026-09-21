import { ref, type ComputedRef } from 'vue'

import { uploadBlobNamed } from '@/utils/uploadCanvas'
import { readWidgetNum, readWidgetStr, writeWidget } from '@/utils/widget'
import { captureSceneImages } from '@/widgets/three/scene3d/capture/SceneImageCapture'
import {
  SceneVideoRecorder,
  isVideoRecordingSupported,
  type RecordProgress
} from '@/widgets/three/scene3d/capture/SceneVideoRecorder'
import {
  SCENE_CHANNELS,
  type SceneChannel
} from '@/widgets/three/scene3d/capture/channelRender'
import { cloneScene } from '@/widgets/three/scene3d/types'

import {
  CHANNEL_WIDGET,
  HEIGHT_WIDGET,
  IMAGE_WIDGET,
  IMAGES_WIDGET,
  VIDEO_WIDGET,
  WIDTH_WIDGET,
  toastError,
  tr,
  type Scene3dStageCore
} from './scene3dStageCore'

export interface Scene3dCaptureCallbacks {
  onCaptured?: (url: string) => void
  onRecorded?: (url: string) => void
}

export function useScene3dCapture(
  core: Scene3dStageCore,
  hasRecordableDuration: ComputedRef<boolean>,
  opts?: Scene3dCaptureCallbacks
) {
  const { node, state } = core

  const outputWidth = ref(readWidgetNum(node, WIDTH_WIDGET, 1024))
  const outputHeight = ref(readWidgetNum(node, HEIGHT_WIDGET, 1024))
  const channel = ref<SceneChannel>(readChannelWidget())
  const capturing = ref(false)
  const recording = ref(false)
  const recordProgress = ref<RecordProgress | null>(null)
  const capturedImageUrl = ref(readWidgetStr(node, IMAGE_WIDGET, ''))
  const capturedVideoUrl = ref(readWidgetStr(node, VIDEO_WIDGET, ''))
  const recordingSupported = isVideoRecordingSupported()

  function readChannelWidget(): SceneChannel {
    const raw = readWidgetStr(node, CHANNEL_WIDGET, 'color')
    return (SCENE_CHANNELS as readonly string[]).includes(raw)
      ? (raw as SceneChannel)
      : 'color'
  }

  function reloadFromNode(): void {
    outputWidth.value = readWidgetNum(node, WIDTH_WIDGET, 1024)
    outputHeight.value = readWidgetNum(node, HEIGHT_WIDGET, 1024)
    channel.value = readChannelWidget()
    capturedImageUrl.value = readWidgetStr(node, IMAGE_WIDGET, '')
    capturedVideoUrl.value = readWidgetStr(node, VIDEO_WIDGET, '')
  }

  function setOutputSize(width: number | null, height: number | null): void {
    if (width !== null && Number.isFinite(width)) {
      outputWidth.value = Math.min(Math.max(Math.round(width), 64), 4096)
      writeWidget(node, WIDTH_WIDGET, outputWidth.value, {
        fireCallback: false
      })
    }
    if (height !== null && Number.isFinite(height)) {
      outputHeight.value = Math.min(Math.max(Math.round(height), 64), 4096)
      writeWidget(node, HEIGHT_WIDGET, outputHeight.value, {
        fireCallback: false
      })
    }
    core.viewport?.refreshViewport()
  }

  function setChannel(next: SceneChannel): void {
    channel.value = next
    writeWidget(node, CHANNEL_WIDGET, next, { fireCallback: false })
    core.viewport?.setPreviewChannel(next)
  }

  function setOutputFps(fps: number | null): void {
    if (fps === null || !Number.isFinite(fps)) return
    const next = cloneScene(state.value)
    next.output.fps = fps
    core.commit(next, 'output:fps')
  }

  function setOutputFrameCount(frameCount: number | null): void {
    if (frameCount === null || !Number.isFinite(frameCount)) return
    const next = cloneScene(state.value)
    next.output.frameCount = frameCount
    core.commit(next, 'output:frameCount')
  }

  async function capture(): Promise<void> {
    const viewport = core.viewport
    if (!viewport || capturing.value || recording.value) return
    capturing.value = true
    try {
      const cameraIds = state.value.cameras.map((camera) => camera.id)
      const targets: Array<string | null> =
        cameraIds.length === 0
          ? [null]
          : state.value.output.cameraId === ''
            ? [null, ...cameraIds]
            : cameraIds
      const shots = await captureSceneImages(
        viewport,
        {
          width: outputWidth.value,
          height: outputHeight.value,
          channel: channel.value
        },
        targets
      )
      const stamp = Date.now()
      const uploads: Array<{ label: string; url: string }> = []
      for (const shot of shots) {
        const label = shot.cameraId ?? 'view'
        const uploaded = await uploadBlobNamed(shot.blob, {
          subfolder: 'comfytv/scene3d',
          filename: `comfytv-scene3d-${String(node?.id ?? 'unknown')}-${stamp}-${label}.png`
        })
        uploads.push({ label, url: uploaded.url })
      }

      const primaryIndex = Math.max(
        0,
        shots.findIndex((shot) =>
          state.value.output.cameraId === ''
            ? shot.cameraId === null
            : shot.cameraId === state.value.output.cameraId
        )
      )
      const batch = JSON.stringify({
        images: uploads.map((upload, index) => ({
          index: String(index + 1),
          label: upload.label,
          image_url: upload.url
        }))
      })
      capturedImageUrl.value = uploads[primaryIndex].url
      writeWidget(node, IMAGE_WIDGET, uploads[primaryIndex].url, {
        fireCallback: false
      })
      writeWidget(node, IMAGES_WIDGET, batch, { fireCallback: false })
      opts?.onCaptured?.(uploads[primaryIndex].url)
    } catch (error) {
      console.error('[ComfyTV/scene3d] capture failed', error)
      toastError(tr('scene3d.captureFailed'))
    } finally {
      capturing.value = false
    }
  }

  function resolveFrameCount(fps: number): number {
    if (state.value.output.frameCount > 0) return state.value.output.frameCount
    const duration = core.viewport?.timelineController.totalDuration ?? 0
    return Math.max(1, Math.round(duration * fps))
  }

  async function record(): Promise<void> {
    const viewport = core.viewport
    if (!viewport || capturing.value || recording.value) return
    if (!recordingSupported) {
      toastError(tr('scene3d.webcodecsUnsupported'))
      return
    }
    if (!hasRecordableDuration.value) {
      toastError(tr('scene3d.noDurationToRecord'))
      return
    }
    recording.value = true
    recordProgress.value = null
    try {
      const fps = state.value.output.fps
      const blob = await new SceneVideoRecorder(viewport).record({
        width: outputWidth.value,
        height: outputHeight.value,
        channel: channel.value,
        fps,
        frameCount: resolveFrameCount(fps),
        onProgress: (progress) => {
          recordProgress.value = progress
        }
      })
      const uploaded = await uploadBlobNamed(blob, {
        subfolder: 'comfytv/scene3d',
        filename: `comfytv-scene3d-${String(node?.id ?? 'unknown')}-${Date.now()}.webm`
      })
      capturedVideoUrl.value = uploaded.url
      writeWidget(node, VIDEO_WIDGET, uploaded.url, { fireCallback: false })
      opts?.onRecorded?.(uploaded.url)
    } catch (error) {
      console.error('[ComfyTV/scene3d] record failed', error)
      toastError(tr('scene3d.recordFailed'))
    } finally {
      recording.value = false
      recordProgress.value = null
    }
  }

  return {
    outputWidth,
    outputHeight,
    channel,
    capturing,
    recording,
    recordProgress,
    recordingSupported,
    capturedImageUrl,
    capturedVideoUrl,
    reloadFromNode,
    setOutputSize,
    setChannel,
    setOutputFps,
    setOutputFrameCount,
    capture,
    record
  }
}
