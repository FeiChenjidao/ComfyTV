import * as THREE from 'three'

import type { LetterboxNdc } from '@/widgets/three/load3d/load3dViewport'

const HOVER_COLOR = 0x4a9eff

export interface ScenePickerHost {
  scene: THREE.Scene
  canvas: HTMLCanvasElement
  getRenderCamera(): THREE.Camera
  clientPointToNdc(clientX: number, clientY: number): LetterboxNdc | null
  pickables(): THREE.Object3D[]
  getSceneObject(id: string): THREE.Object3D | null
}

export class ScenePicker {
  private readonly raycaster = new THREE.Raycaster()
  private readonly hoverBox = new THREE.BoxHelper(
    new THREE.Object3D(),
    HOVER_COLOR
  )
  hoveredId: string | null = null

  constructor(private readonly host: ScenePickerHost) {
    this.hoverBox.visible = false
    host.scene.add(this.hoverBox)
  }

  pick(event: PointerEvent): string | null {
    const ndc = this.host.clientPointToNdc(event.clientX, event.clientY)
    if (!ndc || !ndc.inside) return null
    this.raycaster.setFromCamera(
      new THREE.Vector2(ndc.x, ndc.y),
      this.host.getRenderCamera()
    )
    const hit = this.raycaster.intersectObjects(this.host.pickables(), true)[0]
    if (!hit) return null
    let object: THREE.Object3D | null = hit.object
    while (object) {
      const id = object.userData.sceneObjectId
      if (typeof id === 'string') return id
      object = object.parent
    }
    return null
  }

  setHovered(id: string | null): void {
    if (this.hoveredId === id) return
    this.hoveredId = id
    this.host.canvas.style.cursor = id ? 'pointer' : ''
    this.updateHoverBox()
  }

  updateHoverBox(): void {
    const target = this.hoveredId
      ? this.host.getSceneObject(this.hoveredId)
      : null
    if (target) {
      this.hoverBox.setFromObject(target)
      this.hoverBox.visible = true
    } else {
      this.hoverBox.visible = false
    }
  }

  setBoxVisible(visible: boolean): void {
    this.hoverBox.visible = visible && this.hoveredId !== null
  }

  dispose(): void {
    this.hoverBox.geometry.dispose()
    ;(this.hoverBox.material as THREE.Material).dispose()
  }
}
