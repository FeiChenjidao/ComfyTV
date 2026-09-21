import * as THREE from 'three'

import { CheckerRoom } from '../CheckerRoom'
import { ReflectiveGridFloor } from '../ReflectiveGridFloor'
import type { SceneEnvironmentConfig } from '../types'
import { createDefaultEnvironment } from '../types'

export interface EnvironmentRigHost {
  scene: THREE.Scene
  contentObjects(): THREE.Object3D[]
  cameraPathBounds(): THREE.Box3 | null
}

export function enableDefaultLightShadow(lights: THREE.Light[]): void {
  const mainLight = lights.find(
    (light): light is THREE.DirectionalLight =>
      light instanceof THREE.DirectionalLight
  )
  if (!mainLight) return
  mainLight.castShadow = true
  mainLight.shadow.mapSize.set(2048, 2048)
  mainLight.shadow.camera.left = -20
  mainLight.shadow.camera.right = 20
  mainLight.shadow.camera.top = 20
  mainLight.shadow.camera.bottom = -20
  mainLight.shadow.camera.far = 100
  mainLight.shadow.bias = -0.0001
  mainLight.shadow.normalBias = 0.02
}

export class EnvironmentRig {
  private environment: SceneEnvironmentConfig = createDefaultEnvironment()
  private readonly checkerRoom = new CheckerRoom()
  private readonly gridFloor: ReflectiveGridFloor

  constructor(
    private readonly host: EnvironmentRigHost,
    maxAnisotropy: number
  ) {
    this.checkerRoom.attach(host.scene)
    this.gridFloor = new ReflectiveGridFloor(maxAnisotropy)
    this.gridFloor.attach(host.scene)
  }

  apply(environment: SceneEnvironmentConfig): void {
    this.environment = { ...environment }
    this.gridFloor.setVisible(environment.showGrid)
    this.host.scene.background = environment.background
      ? new THREE.Color(environment.background)
      : null
    this.refresh()
  }

  refresh(): void {
    this.checkerRoom.update(
      this.environment.showRoom
        ? this.environment.floorOnly
          ? 'floor'
          : 'full'
        : 'off',
      this.computeRoomBounds()
    )
  }

  setGridVisible(visible: boolean): void {
    this.gridFloor.setVisible(visible && this.environment.showGrid)
  }

  setRoomLayerVisibility(walls: boolean, floor: boolean): void {
    this.checkerRoom.setLayerVisibility(walls, floor)
  }

  resetRoomLayerVisibility(): void {
    this.checkerRoom.resetLayerVisibility()
  }

  private computeRoomBounds(): THREE.Box3 {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-8, -0.01, -8),
      new THREE.Vector3(8, 8, 8)
    )
    const content = new THREE.Box3()
    for (const object of this.host.contentObjects()) {
      content.expandByObject(object)
    }
    if (!content.isEmpty()) {
      content.expandByScalar(2)
      bounds.union(content)
    }
    const path = this.host.cameraPathBounds()
    if (path && !path.isEmpty()) {
      path.expandByScalar(5)
      bounds.union(path)
    }
    bounds.min.y = Math.min(bounds.min.y, -0.01)
    return bounds
  }

  dispose(): void {
    this.checkerRoom.dispose()
    this.gridFloor.dispose()
  }
}
