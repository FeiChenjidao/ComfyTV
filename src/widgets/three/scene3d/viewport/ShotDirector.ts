import * as THREE from 'three'

import type { Scene3dCharacterManager } from '../CharacterManager'
import type { SceneCameraManager } from '../SceneCameraManager'
import {
  advanceAimSpring,
  initAimSpring,
  type AimSpringState
} from '../aimSpring'
import { shotAtFrame, shotLocalSeconds, totalShotFrames } from '../shotTiming'
import type { Scene3DState, SceneShotEntry } from '../types'

const LOCK_AIM_HEIGHT = 1.3

export class ShotDirector {
  outputCameraId = ''
  private shots: SceneShotEntry[] = []
  private sceneFps = 24
  private lastEvalSeconds = 0
  private aimSpringKey = ''
  private aimSpring: AimSpringState | null = null
  private readonly aimTmp = new THREE.Vector3()

  constructor(
    private readonly sceneCameraManager: SceneCameraManager,
    private readonly characterManager: Scene3dCharacterManager
  ) {}

  configure(state: Scene3DState): void {
    this.outputCameraId = state.output.cameraId
    this.shots = state.shots
    this.sceneFps = state.output.fps
  }

  hasShots(): boolean {
    return this.shots.length > 0
  }

  shotsDurationSeconds(): number | null {
    return this.shots.length ? totalShotFrames(this.shots) / this.sceneFps : null
  }

  activeShotCameraId(): string {
    const segment = this.activeShotSegment(this.lastEvalSeconds)
    if (!segment) return ''
    return segment.shot.cameraId || this.outputCameraId
  }

  private activeShotSegment(seconds: number) {
    if (!this.shots.length) return null
    return shotAtFrame(
      this.shots,
      Math.floor(seconds * this.sceneFps + 1e-6)
    )
  }

  apply(seconds: number, excludeCameraId: string | null): void {
    this.lastEvalSeconds = seconds
    const segment = this.activeShotSegment(seconds)
    if (!segment) return
    const cameraId = segment.shot.cameraId || this.outputCameraId
    if (!cameraId || cameraId === excludeCameraId) return
    this.sceneCameraManager.setCameraLocalTime(
      cameraId,
      shotLocalSeconds(segment, seconds, this.sceneFps)
    )
    const lockId = segment.shot.lock
    if (!lockId) return
    const camera = this.sceneCameraManager.getCamera(cameraId)
    const target = this.characterManager.getObject(lockId)
    if (!camera || !target) return
    const aimHeight = LOCK_AIM_HEIGHT * target.scale.y
    const shotStartSeconds = segment.startFrame / this.sceneFps
    const targetAt = (localSeconds: number) => {
      const found = this.characterManager.sampleWorldPosition(
        lockId,
        shotStartSeconds + Math.max(0, localSeconds),
        this.aimTmp
      )
      if (!found) this.aimTmp.copy(target.position)
      return {
        x: this.aimTmp.x,
        y: this.aimTmp.y + aimHeight,
        z: this.aimTmp.z
      }
    }
    const key = `${segment.shot.id}|${cameraId}|${lockId}|${this.sceneFps}`
    const toStep = Math.max(
      0,
      Math.floor((seconds - shotStartSeconds) * this.sceneFps + 1e-6)
    )
    if (
      this.aimSpringKey !== key ||
      !this.aimSpring ||
      this.aimSpring.steps > toStep
    ) {
      this.aimSpringKey = key
      this.aimSpring = initAimSpring(targetAt(0))
    }
    advanceAimSpring(this.aimSpring, targetAt, toStep, this.sceneFps)
    camera.lookAt(this.aimSpring.aim.x, this.aimSpring.aim.y, this.aimSpring.aim.z)
  }
}
