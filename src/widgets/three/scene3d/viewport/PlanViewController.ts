import type * as THREE from 'three'

type CameraType = 'perspective' | 'orthographic'

export interface PlanViewHost {
  controlsManager: {
    controls: { target: THREE.Vector3; enableRotate: boolean; update(): void }
  }
  cameraManager: { activeCamera: THREE.Camera; orthographicCamera: THREE.Camera }
  getCurrentCameraType(): CameraType
  toggleCamera(type: CameraType): void
}

export class PlanViewController {
  enabled = false
  private restore: {
    position: THREE.Vector3
    target: THREE.Vector3
    type: CameraType
  } | null = null

  constructor(private readonly host: PlanViewHost) {}

  set(enabled: boolean): void {
    this.enabled = enabled
    const { cameraManager } = this.host
    const controls = this.host.controlsManager.controls
    if (enabled) {
      this.restore = {
        position: cameraManager.activeCamera.position.clone(),
        target: controls.target.clone(),
        type: this.host.getCurrentCameraType()
      }
      this.host.toggleCamera('orthographic')
      const camera = cameraManager.activeCamera
      camera.up.set(0, 0, -1)
      camera.position.set(0, 40, 0)
      controls.target.set(0, 0, 0)
      controls.enableRotate = false
      controls.update()
    } else {
      const restore = this.restore
      this.restore = null
      cameraManager.orthographicCamera.up.set(0, 1, 0)
      this.host.toggleCamera(restore?.type ?? 'perspective')
      const camera = cameraManager.activeCamera
      camera.up.set(0, 1, 0)
      if (restore) {
        camera.position.copy(restore.position)
        controls.target.copy(restore.target)
      }
      controls.enableRotate = true
      controls.update()
    }
  }
}
