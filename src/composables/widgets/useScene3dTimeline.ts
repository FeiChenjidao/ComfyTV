import { ref, watch } from 'vue'

import type {
  TimelineTimeUpdate
} from '@/widgets/three/load3d/TimelineController'
import type { Scene3dViewport } from '@/widgets/three/scene3d/Scene3dViewport'
import { buildPathActionJson } from '@/widgets/three/scene3d/pathStrip'
import { shotSegments } from '@/widgets/three/scene3d/shotTiming'
import {
  CAMERA_COLORS,
  TRACK_COLORS,
  type TimelineTracksData
} from '@/widgets/three/scene3d/timelineTracks'
import type { CharacterAnimationConfig } from '@/widgets/three/scene3d/types'
import { cloneScene } from '@/widgets/three/scene3d/types'

import type { Scene3dStageCore } from './scene3dStageCore'

export function useScene3dTimeline(core: Scene3dStageCore) {
  const { state } = core
  const timelinePlaying = ref(false)
  const timelineFrame = ref(0)
  const timelineLoop = ref(true)

  function buildTimelineData(): TimelineTracksData | null {
    const viewport = core.viewport
    if (!viewport) return null
    const fps = viewport.timelineController.getFps()
    const cameras = state.value.cameras.flatMap((entry, index) => {
      if (!entry.preset) return []
      const info = viewport.sceneCameraManager.getPresetInfo(entry.id)
      if (!info) return []
      return [
        {
          id: entry.id,
          color: CAMERA_COLORS[index % CAMERA_COLORS.length],
          sourceFrames: Math.round((info.frameCount / info.fps) * fps),
          speed: entry.preset.speed
        }
      ]
    })
    const toTrack = (
      entry: { id: string; animation: CharacterAnimationConfig },
      sourceSeconds: number,
      index: number
    ) => {
      const speed = entry.animation.speed || 1
      return {
        id: entry.id,
        color: TRACK_COLORS[index % TRACK_COLORS.length],
        offsetFrames: Math.round(entry.animation.startOffset * fps),
        displayFrames: Math.max(1, Math.round((sourceSeconds / speed) * fps)),
        sourceFrames: Math.round(sourceSeconds * fps),
        loop: entry.animation.loop
      }
    }
    const characters = state.value.characters.map((entry, index) =>
      toTrack(entry, viewport.characterManager.getClipDuration(entry.id), index)
    )
    const models = state.value.models
      .filter((entry) => entry.animation.clip !== '')
      .map((entry, index) =>
        toTrack(
          entry,
          viewport.customModelManager.getClipDuration(entry.id),
          characters.length + index
        )
      )
    const shots = state.value.shots?.length
      ? shotSegments(state.value.shots).map((segment) => {
          const cameraIndex = state.value.cameras.findIndex(
            (camera) => camera.id === segment.shot.cameraId
          )
          return {
            id: segment.shot.id,
            color:
              cameraIndex >= 0
                ? CAMERA_COLORS[cameraIndex % CAMERA_COLORS.length]
                : '#8a8a9a',
            startFrame: segment.startFrame,
            endFrame: segment.endFrame
          }
        })
      : undefined
    return {
      fps,
      cameras,
      characters: [...characters, ...models],
      ...(shots ? { shots } : {})
    }
  }

  function commitPathEdit(id: string, label: string): void {
    const exported = core.viewport?.characterManager.exportPathAction(id)
    if (!exported) return
    const next = cloneScene(state.value)
    const target = next.characters.find((entry) => entry.id === id)
    if (!target?.path) return
    target.path = { ...target.path, action: exported }
    core.commit(next, `path:${id}:${label}`)
  }

  function addCharacterPathById(id: string): void {
    const next = cloneScene(state.value)
    const target = next.characters.find((entry) => entry.id === id)
    if (!target || target.path) return
    const { position, quaternion: q } = target.transform
    const yaw = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.x * q.x)
    )
    const dx = Math.sin(yaw)
    const dz = Math.cos(yaw)
    target.path = {
      action: buildPathActionJson([
        [position.x, 0, position.z],
        [position.x + dx * 3, 0, position.z + dz * 3]
      ]),
      syncSpeed: 1.4
    }
    core.commit(next)
  }

  function removeCharacterPathById(id: string): void {
    const next = cloneScene(state.value)
    const target = next.characters.find((entry) => entry.id === id)
    if (!target?.path) return
    delete target.path
    core.commit(next)
  }

  function handleTimelineTogglePlay(): void {
    core.viewport?.timelineController.togglePlayPause()
  }

  function handleTimelineSeek(frame: number): void {
    core.viewport?.timelineController.seekToFrame(frame)
  }

  watch(timelineLoop, (loop) => {
    core.viewport?.timelineController.setLoopPlayback(loop)
  })

  function wireViewportEvents(target: Scene3dViewport): void {
    target.addEventListener(
      'timelineTimeUpdate',
      (data: TimelineTimeUpdate) => {
        timelineFrame.value = data.frame
      }
    )
    target.addEventListener('timelineDurationChange', () => {
      core.timelineDataVersion.value += 1
    })
    target.addEventListener(
      'timelineStateChange',
      (data: { playing: boolean; loop: boolean }) => {
        timelinePlaying.value = data.playing
        timelineLoop.value = data.loop
        core.writeEditorProps({ timelinePlaying: data.playing })
        core.viewport?.setTimelinePlayIntent(data.playing)
      }
    )
  }

  return {
    timelinePlaying,
    timelineFrame,
    timelineLoop,
    buildTimelineData,
    commitPathEdit,
    addCharacterPathById,
    removeCharacterPathById,
    handleTimelineTogglePlay,
    handleTimelineSeek,
    wireViewportEvents
  }
}
