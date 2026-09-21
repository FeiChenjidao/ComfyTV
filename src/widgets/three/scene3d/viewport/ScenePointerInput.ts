import { exceedsClickThreshold } from '@/composables/useClickDragGuard'
import type { GizmoManager } from '@/widgets/three/load3d/GizmoManager'

import type { LightHandleController } from './LightHandleController'
import type { PathEditorController } from './PathEditorController'
import type { ScenePicker } from './ScenePicker'

const CLICK_DRAG_THRESHOLD = 5

export interface ScenePointerHost {
  canvas: HTMLCanvasElement
  capturing: boolean
  selectedId: string | null
  gizmoManager: GizmoManager
  pathEditor: PathEditorController
  lightHandles: LightHandleController
  picker: ScenePicker
  events: { onSelectCharacter(id: string | null): void }
  controlsManager: { controls: { enabled: boolean } }
  effectiveGizmoMode(): string
}

export class ScenePointerInput {
  private pointerDownAt: { x: number; y: number } | null = null
  private pointerDownOnGizmo = false

  constructor(private readonly host: ScenePointerHost) {
    const canvas = host.canvas
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerleave', this.handlePointerLeave)
    canvas.addEventListener('pointercancel', this.handlePointerCancel)
  }

  dispose(): void {
    const canvas = this.host.canvas
    canvas.removeEventListener('pointerdown', this.handlePointerDown)
    canvas.removeEventListener('pointerup', this.handlePointerUp)
    canvas.removeEventListener('pointermove', this.handlePointerMove)
    canvas.removeEventListener('pointerleave', this.handlePointerLeave)
    canvas.removeEventListener('pointercancel', this.handlePointerCancel)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const host = this.host
    if (event.button !== 0) return
    if (host.capturing) return

    if (host.pathEditor.pick(event.clientX, event.clientY)) {
      host.pathEditor.dragging = true
      host.controlsManager.controls.enabled = false
      this.pointerDownAt = null
      this.pointerDownOnGizmo = true
      return
    }

    if (host.lightHandles.tryBeginRingDrag(event)) {
      this.pointerDownOnGizmo = true
      this.pointerDownAt = null
      return
    }

    this.pointerDownAt = { x: event.clientX, y: event.clientY }
    this.pointerDownOnGizmo =
      host.gizmoManager.isInteracting() || host.lightHandles.isInteracting()
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const host = this.host
    if (event.button !== 0) return
    if (host.capturing) return

    if (host.pathEditor.dragging) {
      host.pathEditor.dragging = false
      host.controlsManager.controls.enabled = true
      return
    }

    if (host.lightHandles.endRingDrag(event)) return

    const downAt = this.pointerDownAt
    this.pointerDownAt = null
    if (!downAt || this.pointerDownOnGizmo) return
    if (
      exceedsClickThreshold(
        downAt,
        { x: event.clientX, y: event.clientY },
        CLICK_DRAG_THRESHOLD
      )
    ) {
      return
    }
    const id = host.picker.pick(event)
    if (id === null && host.effectiveGizmoMode() !== 'none') return
    if (id === host.selectedId) return
    host.events.onSelectCharacter(id)
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const host = this.host
    if (host.capturing) return
    host.gizmoManager.setSnapping(event.ctrlKey || event.metaKey)
    if (host.lightHandles.updateRingDrag(event)) return
    if (
      event.buttons !== 0 ||
      host.gizmoManager.isInteracting() ||
      host.lightHandles.isInteracting()
    ) {
      host.picker.setHovered(null)
      host.lightHandles.setRingHovered(null)
      return
    }
    const ring = host.lightHandles.pickRing(event)
    if (ring) {
      host.lightHandles.setRingHovered(ring)
      host.picker.setHovered(null)
      host.canvas.style.cursor = 'grab'
      return
    }
    host.lightHandles.setRingHovered(null)
    host.picker.setHovered(host.picker.pick(event))
  }

  private readonly handlePointerLeave = (): void => {
    this.host.picker.setHovered(null)
    this.host.lightHandles.setRingHovered(null)
  }

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.host.lightHandles.cancelRingDrag(event)
  }
}
