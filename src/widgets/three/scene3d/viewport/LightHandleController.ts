import * as THREE from 'three'

import {
  LightOrbitHandles,
  type LightOrbitHandleType
} from '@/widgets/three/light/LightOrbitHandles'
import { PositionHandle } from '@/widgets/three/light/PositionHandle'
import { pickHandleAtPointer } from '@/widgets/three/light/handlePicking'
import {
  orbitAnglesFor,
  orbitPosition
} from '@/widgets/three/light/lightTransform'
import {
  pointToDistance,
  pointToPitchAngle,
  pointToYawAngle
} from '@/widgets/three/light/orbitDragMath'
import { lightTarget } from '@/widgets/three/light/types'
import type { LetterboxNdc } from '@/widgets/three/load3d/load3dViewport'

import type { Scene3dLightManager } from '../LightManager'
import type { SceneLightEntry, Vec3 } from '../types'

export interface LightHandleHost {
  scene: THREE.Scene
  canvas: HTMLCanvasElement
  cameraManager: { activeCamera: THREE.Camera }
  lightManager: Scene3dLightManager
  events: { onLightChange(id: string, patch: Partial<SceneLightEntry>): void }
  getRenderCamera(): THREE.Camera
  clientPointToNdc(clientX: number, clientY: number): LetterboxNdc | null
  renderRegionSize(): { clientWidth: number; clientHeight: number }
  controlsManager: { controls: { enabled: boolean } }
  selectedLightEntry(): SceneLightEntry | null
}

export class LightHandleController {
  private readonly orbitHandles = new LightOrbitHandles()
  private readonly positionHandle: PositionHandle
  private readonly targetHandle: PositionHandle
  private readonly raycaster = new THREE.Raycaster()
  private hoveredRing: LightOrbitHandleType | null = null
  private ringDrag: {
    type: LightOrbitHandleType
    pointerId: number
  } | null = null

  constructor(private readonly host: LightHandleHost) {
    const getPointerNdc = (clientX: number, clientY: number) =>
      host.clientPointToNdc(clientX, clientY)
    this.orbitHandles.attach(host.scene)
    this.positionHandle = new PositionHandle(
      'Scene3dLightPositionHandle',
      host.cameraManager.activeCamera,
      host.canvas,
      (dragging) => {
        host.controlsManager.controls.enabled = !dragging
        if (dragging) return
        const entry = host.selectedLightEntry()
        if (entry) {
          host.events.onLightChange(entry.id, { position: { ...entry.position } })
        }
      },
      (position) => this.patchSelectedLight({ position }),
      { getPointerNdc }
    )
    this.positionHandle.attach(host.scene)
    this.targetHandle = new PositionHandle(
      'Scene3dLightTargetHandle',
      host.cameraManager.activeCamera,
      host.canvas,
      (dragging) => {
        host.controlsManager.controls.enabled = !dragging
        if (dragging) return
        const entry = host.selectedLightEntry()
        if (entry?.target) {
          host.events.onLightChange(entry.id, { target: { ...entry.target } })
        }
      },
      (target) => this.patchSelectedLight({ target }),
      { getPointerNdc }
    )
    this.targetHandle.attach(host.scene)
  }

  sync(): void {
    const entry = this.host.selectedLightEntry()
    this.orbitHandles.update(entry)
    const showPosition = !!entry && entry.type !== 'directional'
    this.positionHandle.setVisible(showPosition)
    const showTarget = !!entry && entry.type !== 'point'
    this.targetHandle.setVisible(showTarget)
    if (entry) {
      this.positionHandle.setPosition(entry.position)
      this.targetHandle.setPosition(lightTarget(entry))
    }
    if (!entry) this.setRingHovered(null)
  }

  hide(): void {
    this.orbitHandles.setVisible(false)
    this.positionHandle.setVisible(false)
    this.targetHandle.setVisible(false)
  }

  isInteracting(): boolean {
    return (
      this.positionHandle.isInteracting() || this.targetHandle.isInteracting()
    )
  }

  updateCamera(camera: THREE.Camera): void {
    this.positionHandle.updateCamera(camera)
    this.targetHandle.updateCamera(camera)
  }

  private patchSelectedLight(patch: Partial<SceneLightEntry>): void {
    const entry = this.host.selectedLightEntry()
    if (!entry) return
    const patched = this.host.lightManager.patchEntry(entry.id, patch)
    if (patched) this.orbitHandles.update(patched)
  }

  pickRing(event: PointerEvent): LightOrbitHandleType | null {
    const entry = this.host.selectedLightEntry()
    if (!entry || entry.type !== 'directional') return null
    if (!this.orbitHandles.isVisible()) return null
    const ndc = this.host.clientPointToNdc(event.clientX, event.clientY)
    if (!ndc || !ndc.inside) return null
    return pickHandleAtPointer<LightOrbitHandleType>(
      this.raycaster,
      new THREE.Vector2(ndc.x, ndc.y),
      this.host.getRenderCamera(),
      this.orbitHandles.pickableMeshes(),
      this.host.renderRegionSize()
    )
  }

  setRingHovered(type: LightOrbitHandleType | null): void {
    if (this.hoveredRing === type) return
    this.hoveredRing = type
    this.orbitHandles.setHovered(type)
    if (!type && !this.ringDrag) {
      this.host.canvas.style.cursor = ''
    }
  }

  tryBeginRingDrag(event: PointerEvent): boolean {
    const ring = this.pickRing(event)
    if (!ring) return false
    this.ringDrag = { type: ring, pointerId: event.pointerId }
    this.host.canvas.setPointerCapture(event.pointerId)
    this.host.canvas.style.cursor = 'grabbing'
    this.host.controlsManager.controls.enabled = false
    return true
  }

  private ownsPointer(event: PointerEvent): boolean {
    return !!this.ringDrag && event.pointerId === this.ringDrag.pointerId
  }

  private releaseRingDrag(event: PointerEvent): void {
    const canvas = this.host.canvas
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
    this.ringDrag = null
    canvas.style.cursor = ''
    this.host.controlsManager.controls.enabled = true
  }

  endRingDrag(event: PointerEvent): boolean {
    if (!this.ownsPointer(event)) return false
    this.releaseRingDrag(event)
    const entry = this.host.selectedLightEntry()
    if (entry) {
      this.host.events.onLightChange(entry.id, { position: { ...entry.position } })
    }
    return true
  }

  cancelRingDrag(event: PointerEvent): void {
    if (!this.ownsPointer(event)) return
    this.releaseRingDrag(event)
  }

  updateRingDrag(event: PointerEvent): boolean {
    if (!this.ownsPointer(event)) return false
    const drag = this.ringDrag!
    const entry = this.host.selectedLightEntry()
    if (!entry) return true
    const ndc = this.host.clientPointToNdc(event.clientX, event.clientY)
    if (!ndc) return true
    this.raycaster.setFromCamera(
      new THREE.Vector2(ndc.x, ndc.y),
      this.host.getRenderCamera()
    )
    const plane = this.orbitHandles.dragPlaneFor(drag.type, entry)
    const point = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(plane, point)) return true
    const target = lightTarget(entry)
    const angles = orbitAnglesFor(entry.position, target)
    if (drag.type === 'yaw') {
      angles.yaw = pointToYawAngle(point, target)
    } else if (drag.type === 'pitch') {
      angles.pitch = pointToPitchAngle(point, target, angles.yaw)
    } else {
      angles.distance = pointToDistance(point, target, angles.yaw, angles.pitch)
    }
    const position: Vec3 = orbitPosition(
      target,
      angles.yaw,
      angles.pitch,
      angles.distance
    )
    this.patchSelectedLight({ position })
    return true
  }

  dispose(): void {
    this.orbitHandles.dispose()
    this.positionHandle.dispose()
    this.targetHandle.dispose()
  }
}
