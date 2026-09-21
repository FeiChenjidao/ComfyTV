import type * as THREE from 'three'

import type { GizmoManager } from '@/widgets/three/load3d/GizmoManager'
import type { GizmoMode } from '@/widgets/three/load3d/interfaces'

import type { Scene3dCharacterManager } from '../CharacterManager'
import type { Scene3dLightManager } from '../LightManager'
import type { SceneCameraManager } from '../SceneCameraManager'
import type { CharacterTransform, Vec3 } from '../types'
import type { LightHandleController } from './LightHandleController'

export type Scene3dGizmoMode = GizmoMode | 'none'

export interface GizmoBridgeHost {
  selectedId: string | null
  lookThroughCameraId: string | null
  gizmoManager: GizmoManager
  lightManager: Scene3dLightManager
  characterManager: Scene3dCharacterManager
  sceneCameraManager: SceneCameraManager
  lightHandles: LightHandleController
  events: {
    onTransformCommit(id: string, transform: CharacterTransform): void
    onCameraOffsetCommit(id: string, offset: Vec3): void
  }
  getSceneObject(id: string): THREE.Object3D | null
}

export class GizmoBridge {
  mode: Scene3dGizmoMode = 'none'

  constructor(private readonly host: GizmoBridgeHost) {}

  effectiveMode(): Scene3dGizmoMode {
    const { selectedId: id, sceneCameraManager } = this.host
    const mode = this.mode
    if (!id || mode === 'none') return 'none'
    if (this.host.lightManager.isLight(id)) return 'none'
    if (
      this.host.characterManager.getParsedPath(id) &&
      (mode === 'translate' || mode === 'rotate')
    ) {
      return 'none'
    }
    if (sceneCameraManager.isCamera(id)) {
      if (this.host.lookThroughCameraId === id) return 'none'
      if (mode === 'scale') return 'none'
      if (mode === 'rotate' && sceneCameraManager.getEntry(id)?.preset) {
        return 'none'
      }
    }
    return mode
  }

  attach(): void {
    const { selectedId, gizmoManager } = this.host
    const mode = this.effectiveMode()
    const target = selectedId ? this.host.getSceneObject(selectedId) : null
    if (target && target.visible && mode !== 'none') {
      gizmoManager.setupForModel(target)
      gizmoManager.setMode(mode)
      gizmoManager.setEnabled(true)
    } else {
      gizmoManager.detach()
    }
    this.host.lightHandles.sync()
  }

  frozenCameraId(): string | null {
    if (!this.host.gizmoManager.isInteracting()) return null
    const mode = this.effectiveMode()
    if (mode !== 'translate' && mode !== 'rotate') return null
    const id = this.host.selectedId
    return id && this.host.sceneCameraManager.isCamera(id) ? id : null
  }

  followSelected(): void {
    const id = this.host.selectedId
    if (!id || !this.host.sceneCameraManager.isCamera(id)) return
    this.host.gizmoManager.followTarget()
  }

  updateLivePresetDrag(): void {
    const { gizmoManager, sceneCameraManager } = this.host
    if (!gizmoManager.isInteracting()) return
    const id = this.host.selectedId
    if (!id || this.effectiveMode() !== 'translate') return
    if (!sceneCameraManager.getEntry(id)?.preset) return
    const object = sceneCameraManager.getObject(id)
    if (object) sceneCameraManager.previewPresetDrag(id, object.position)
  }

  commitTransform(): void {
    const id = this.host.selectedId
    if (!id) return
    const target = this.host.getSceneObject(id)
    if (!target) return
    const cameraEntry = this.host.sceneCameraManager.getEntry(id)
    if (cameraEntry?.preset && this.effectiveMode() === 'translate') {
      const offset = this.host.sceneCameraManager.offsetForWorldPosition(
        id,
        target.position
      )
      if (offset) {
        this.host.events.onCameraOffsetCommit(id, offset)
        return
      }
    }
    this.host.events.onTransformCommit(id, {
      position: {
        x: target.position.x,
        y: target.position.y,
        z: target.position.z
      },
      quaternion: {
        x: target.quaternion.x,
        y: target.quaternion.y,
        z: target.quaternion.z,
        w: target.quaternion.w
      },
      scale: { x: target.scale.x, y: target.scale.y, z: target.scale.z }
    })
  }
}
