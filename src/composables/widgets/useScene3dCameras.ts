import { ref } from 'vue'

import type { CameraPresetTuning } from '@/widgets/three/load3d/interfaces'
import { describeShotPose } from '@/widgets/three/scene3d/filmVocab'
import { shotAtFrame, shotSegments } from '@/widgets/three/scene3d/shotTiming'
import type { SceneCameraEntry } from '@/widgets/three/scene3d/types'
import {
  cloneScene,
  createDefaultCamera,
  createDefaultShot
} from '@/widgets/three/scene3d/types'

import {
  allIds,
  patchMergeKey,
  type Scene3dStageCore
} from './scene3dStageCore'

export function useScene3dCameras(core: Scene3dStageCore) {
  const { state, selectedId, cameraPresets } = core
  const planView = ref(false)

  function togglePlanView(): void {
    planView.value = !planView.value
    core.viewport?.setPlanView(planView.value)
  }

  function addCamera(): void {
    const camera = createDefaultCamera(
      allIds(state.value),
      core.viewport?.getEditorCameraPose()
    )
    const next = cloneScene(state.value)
    next.cameras.push(camera)
    if (!next.output.cameraId) next.output.cameraId = camera.id
    selectedId.value = camera.id
    core.commit(next)
    core.setPipCamera(camera.id)
    core.setLookThrough(camera.id)
  }

  function updateCameraById(
    id: string,
    mutate: (camera: SceneCameraEntry) => void,
    mergeKey?: string
  ): void {
    const next = cloneScene(state.value)
    const camera = next.cameras.find((entry) => entry.id === id)
    if (!camera) return
    mutate(camera)
    core.commit(next, mergeKey)
  }

  function bindCameraPreset(id: string, presetId: string | null): void {
    if (!presetId) {
      updateCameraById(id, (camera) => {
        camera.preset = null
      })
      return
    }
    const entry = cameraPresets.value.find((preset) => preset.id === presetId)
    if (!entry) return
    updateCameraById(id, (camera) => {
      camera.preset = { presetId, file: entry.file, tuning: {}, speed: 1 }
    })
  }

  function updateCameraTuning(
    id: string,
    tuning: Partial<CameraPresetTuning>
  ): void {
    updateCameraById(
      id,
      (camera) => {
        if (!camera.preset) return
        camera.preset.tuning = { ...camera.preset.tuning, ...tuning }
      },
      `camera:${id}:tuning:${patchMergeKey(tuning)}`
    )
  }

  function setCameraFov(id: string, fov: number): void {
    if (!Number.isFinite(fov)) return
    updateCameraById(
      id,
      (camera) => {
        camera.fov = Math.min(Math.max(fov, 10), 140)
      },
      `camera:${id}:fov`
    )
  }

  function setCameraSpeedById(id: string, speed: number): void {
    updateCameraById(
      id,
      (camera) => {
        if (camera.preset) camera.preset.speed = speed
      },
      `camera:${id}:speed`
    )
  }

  function setOutputCamera(id: string): void {
    const next = cloneScene(state.value)
    next.output.cameraId = id
    core.commit(next)
  }

  function addShot(): void {
    const next = cloneScene(state.value)
    const cameraId =
      next.output.cameraId || next.cameras[0]?.id || ''
    const shot = createDefaultShot(cameraId, allIds(state.value))
    next.shots.push(shot)
    selectedId.value = shot.id
    core.writeEditorProps({ selectedId: shot.id })
    core.commit(next)
  }

  function patchShotById(
    id: string,
    patch: { cameraId?: string; lock?: string; durFrames?: number | null }
  ): void {
    const next = cloneScene(state.value)
    const shot = next.shots.find((entry) => entry.id === id)
    if (!shot) return
    if (patch.cameraId !== undefined) shot.cameraId = patch.cameraId
    if (patch.lock !== undefined) {
      if (patch.lock) shot.lock = patch.lock
      else delete shot.lock
    }
    if (patch.durFrames !== undefined && patch.durFrames !== null) {
      shot.durFrames = Math.max(1, Math.min(10000, Math.round(patch.durFrames)))
    }
    core.commit(next, `shot:${id}:${patchMergeKey(patch)}`)
  }

  function setShotDurationById(id: string, durFrames: number): void {
    const next = cloneScene(state.value)
    const shot = next.shots.find((entry) => entry.id === id)
    if (!shot) return
    shot.durFrames = Math.max(1, Math.min(10000, Math.round(durFrames)))
    core.commit(next, `shot:${id}:dur`)
  }

  function moveShotBy(id: string, delta: number): void {
    const index = state.value.shots.findIndex((entry) => entry.id === id)
    if (index < 0) return
    moveShotToIndex(id, index + delta)
  }

  function moveShotToIndex(id: string, targetIndex: number): void {
    const next = cloneScene(state.value)
    const index = next.shots.findIndex((entry) => entry.id === id)
    if (index < 0) return
    const target = Math.min(
      next.shots.length - 1,
      Math.max(0, Math.round(targetIndex))
    )
    if (target === index) return
    const [shot] = next.shots.splice(index, 1)
    next.shots.splice(target, 0, shot)
    core.commit(next)
  }

  function addPromptStrip(): void {
    const next = cloneScene(state.value)
    const frame = Math.round(
      (core.viewport?.timelineController.getCurrentTime() ?? 0) * next.output.fps
    )
    const segment = next.shots.length ? shotAtFrame(next.shots, frame) : null
    const range = segment
      ? { start: segment.startFrame, end: segment.endFrame }
      : { start: 0, end: Math.max(1, Math.round(next.output.fps * 2)) }
    const taken = new Set(allIds(state.value))
    let suffix = 1
    while (taken.has(`prompt_${suffix}`)) suffix += 1
    const strip = { id: `prompt_${suffix}`, range, text: '' }
    next.promptTrack.push(strip)
    selectedId.value = strip.id
    core.writeEditorProps({ selectedId: strip.id })
    core.commit(next)
  }

  function patchPromptById(
    id: string,
    patch: { start?: number | null; end?: number | null; text?: string }
  ): void {
    const next = cloneScene(state.value)
    const strip = next.promptTrack.find((entry) => entry.id === id)
    if (!strip) return
    if (patch.start !== undefined && patch.start !== null) {
      strip.range.start = Math.max(0, Math.round(patch.start))
    }
    if (patch.end !== undefined && patch.end !== null) {
      strip.range.end = Math.min(10000, Math.round(patch.end))
    }
    if (strip.range.end <= strip.range.start) {
      strip.range.end = strip.range.start + 1
    }
    if (patch.text !== undefined) strip.text = patch.text
    core.commit(next, `prompt:${id}:${patchMergeKey(patch)}`)
  }

  function autoFillShotPrompts(): void {
    const viewport = core.viewport
    if (!viewport || !state.value.shots.length) return
    const next = cloneScene(state.value)
    const fps = next.output.fps
    const taken = new Set([...allIds(state.value)])
    for (const segment of shotSegments(next.shots)) {
      const cameraId = segment.shot.cameraId || next.output.cameraId
      const cameraEntry = next.cameras.find((entry) => entry.id === cameraId)
      if (!cameraEntry) continue
      const midSeconds = (segment.startFrame + segment.endFrame) / 2 / fps
      viewport.applyCaptureTime(midSeconds)
      const runtimeCamera = viewport.sceneCameraManager.getCamera(cameraId)
      const pose = runtimeCamera
        ? {
            x: runtimeCamera.position.x,
            y: runtimeCamera.position.y,
            z: runtimeCamera.position.z,
            fovDeg: runtimeCamera.fov
          }
        : { ...cameraEntry.transform.position, fovDeg: cameraEntry.fov }
      const lockId = segment.shot.lock ?? ''
      const subjectId = lockId || next.characters[0]?.id || ''
      const subjectPose = subjectId
        ? viewport.characterManager.sampleWorldPose(subjectId, midSeconds)
        : null
      const subject = subjectPose
        ? {
            x: subjectPose.x,
            y: subjectPose.y,
            z: subjectPose.z,
            heightM: 1.7 * subjectPose.scaleY,
            facingYaw: subjectPose.yaw
          }
        : { x: 0, y: 0, z: 0, heightM: 1.7, facingYaw: null }
      const description = describeShotPose(
        pose,
        subject,
        cameraEntry.preset?.presetId ?? null,
        Boolean(lockId)
      )
      const existing = next.promptTrack.find(
        (strip) =>
          strip.range.start === segment.startFrame &&
          strip.range.end === segment.endFrame
      )
      if (existing) {
        existing.text = description.text
      } else {
        let suffix = 1
        while (taken.has(`prompt_${suffix}`)) suffix += 1
        const id = `prompt_${suffix}`
        taken.add(id)
        next.promptTrack.push({
          id,
          range: { start: segment.startFrame, end: segment.endFrame },
          text: description.text
        })
      }
    }
    viewport.syncSceneToTimeline()
    core.commit(next)
  }

  return {
    planView,
    togglePlanView,
    addCamera,
    bindCameraPreset,
    updateCameraTuning,
    setCameraFov,
    setCameraSpeedById,
    setOutputCamera,
    addShot,
    patchShotById,
    setShotDurationById,
    moveShotBy,
    moveShotToIndex,
    addPromptStrip,
    patchPromptById,
    autoFillShotPrompts
  }
}
