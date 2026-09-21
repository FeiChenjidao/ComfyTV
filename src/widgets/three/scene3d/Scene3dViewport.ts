import * as THREE from 'three'

import type { GizmoManager } from '@/widgets/three/load3d/GizmoManager'
import type { TimelineController } from '@/widgets/three/load3d/TimelineController'
import {
  Viewport3d,
  type Viewport3dDeps
} from '@/widgets/three/load3d/Viewport3d'
import type { Load3DOptions } from '@/widgets/three/load3d/interfaces'
import {
  computeLetterboxedViewport,
  isLoad3dActive
} from '@/widgets/three/load3d/load3dViewport'

import type { Scene3dCharacterManager } from './CharacterManager'
import type { Scene3dCustomModelManager } from './CustomModelManager'
import type { Scene3dLightManager } from './LightManager'
import type { SceneCameraManager } from './SceneCameraManager'
import type { Scene3dPrimitiveManager } from './PrimitiveManager'
import type { CaptureLayers, SceneChannel } from './capture/channelRender'
import { idMatteColorById } from './idMatte'
import { sceneAnimationDuration } from './characterTime'
import { cameraPose } from './transformMath'
import type {
  CharacterTransform,
  Scene3DState,
  SceneLightEntry,
  Vec3
} from './types'
import { ChannelPreviewRenderer } from './viewport/ChannelPreviewRenderer'
import {
  EnvironmentRig,
  enableDefaultLightShadow
} from './viewport/EnvironmentRig'
import { GizmoBridge, type Scene3dGizmoMode } from './viewport/GizmoBridge'
import { LightHandleController } from './viewport/LightHandleController'
import { PathEditorController } from './viewport/PathEditorController'
import { PlanViewController } from './viewport/PlanViewController'
import { SceneObjectIndex } from './viewport/SceneObjectIndex'
import { ScenePicker } from './viewport/ScenePicker'
import { ScenePointerInput } from './viewport/ScenePointerInput'
import { ShotDirector } from './viewport/ShotDirector'
import { TimelineDurationSync } from './viewport/TimelineDurationSync'

export type { Scene3dGizmoMode } from './viewport/GizmoBridge'

export type Scene3dViewportDeps = Viewport3dDeps & {
  timelineController: TimelineController
  sceneCameraManager: SceneCameraManager
  characterManager: Scene3dCharacterManager
  primitiveManager: Scene3dPrimitiveManager
  customModelManager: Scene3dCustomModelManager
  lightManager: Scene3dLightManager
  gizmoManager: GizmoManager
}

export interface Scene3dViewportEvents {
  onTransformCommit(id: string, transform: CharacterTransform): void
  onSelectCharacter(id: string | null): void
  onLightChange(id: string, patch: Partial<SceneLightEntry>): void
  onCameraOffsetCommit(id: string, offset: Vec3): void
  onPathCommit?(id: string, label: string): void
}

export class Scene3dViewport extends Viewport3d {
  readonly timelineController: TimelineController
  readonly sceneCameraManager: SceneCameraManager
  readonly characterManager: Scene3dCharacterManager
  readonly primitiveManager: Scene3dPrimitiveManager
  readonly customModelManager: Scene3dCustomModelManager
  readonly lightManager: Scene3dLightManager
  readonly gizmoManager: GizmoManager
  readonly events: Scene3dViewportEvents

  readonly objects: SceneObjectIndex
  readonly director: ShotDirector
  readonly timeline: TimelineDurationSync
  readonly picker: ScenePicker
  readonly lightHandles: LightHandleController
  readonly pathEditor: PathEditorController
  readonly environment: EnvironmentRig
  readonly channels: ChannelPreviewRenderer
  readonly gizmo: GizmoBridge
  readonly plan: PlanViewController
  private readonly pointer: ScenePointerInput

  capturing = false

  private selected: string | null = null
  private lookThroughId: string | null = null
  private captureLayers: CaptureLayers | null = null
  private idColors = new Map<string, string>()
  private captureCameraOverride: THREE.PerspectiveCamera | null = null
  private applyStateEpoch = 0
  private selectionEpoch = 0
  private pipCameraId: string | null = null

  constructor(
    container: HTMLElement,
    deps: Scene3dViewportDeps,
    events: Scene3dViewportEvents,
    options: Load3DOptions = {}
  ) {
    super(container, deps, options)
    this.timelineController = deps.timelineController
    this.sceneCameraManager = deps.sceneCameraManager
    this.characterManager = deps.characterManager
    this.customModelManager = deps.customModelManager
    this.primitiveManager = deps.primitiveManager
    this.lightManager = deps.lightManager
    this.gizmoManager = deps.gizmoManager
    this.events = events

    this.gizmoManager.init()
    this.objects = new SceneObjectIndex(this)
    this.director = new ShotDirector(
      this.sceneCameraManager,
      this.characterManager
    )
    this.timeline = new TimelineDurationSync(
      this.timelineController,
      this.director,
      this.sceneCameraManager
    )
    this.picker = new ScenePicker(this)
    this.scene.remove(this.sceneManager.gridHelper)
    this.environment = new EnvironmentRig(
      this,
      this.renderer.capabilities.getMaxAnisotropy()
    )
    enableDefaultLightShadow(this.lightingManager.lights)
    this.lightHandles = new LightHandleController(this)
    this.pathEditor = new PathEditorController(this)
    this.channels = new ChannelPreviewRenderer(this)
    this.gizmo = new GizmoBridge(this)
    this.plan = new PlanViewController(this)
    this.pointer = new ScenePointerInput(this)

    this.eventManager.addEventListener('timelineTimeUpdate', () => {
      if (this.timelineController.isPlayingNow()) return
      if (this.capturing) return
      this.syncSceneToTimeline()
      this.forceRender()
    })

    this.start()
  }

  get scene(): THREE.Scene {
    return this.sceneManager.scene
  }

  get canvas(): HTMLCanvasElement {
    return this.domElement
  }

  get selectedId(): string | null {
    return this.selected
  }

  get lookThroughCameraId(): string | null {
    return this.lookThroughId
  }

  viewSize(): { width: number; height: number } {
    return { width: this.view.width, height: this.view.height }
  }

  protected override tickPerFrame(delta: number): void {
    super.tickPerFrame(delta)
    this.timelineController.update(delta)
    this.syncSceneToTimeline()
    this.gizmo.updateLivePresetDrag()
    this.gizmo.followSelected()
    this.picker.updateHoverBox()
  }

  syncSceneToTimeline(): void {
    const time = this.timelineController.getCurrentTime()
    this.sceneCameraManager.setTimelineTime(time, this.gizmo.frozenCameraId())
    this.characterManager.setTimelineTime(time)
    this.customModelManager.setTimelineTime(time)
    this.director.apply(time, this.gizmo.frozenCameraId())
  }

  hasShots(): boolean {
    return this.director.hasShots()
  }

  applyCaptureTime(seconds: number): void {
    this.sceneCameraManager.setTimelineTime(seconds)
    this.characterManager.setTimelineTime(seconds)
    this.customModelManager.setTimelineTime(seconds)
    this.director.apply(seconds, null)
  }

  override isActive(): boolean {
    if (this.capturing) return false
    return isLoad3dActive({
      mouseOnNode: this.STATUS_MOUSE_ON_NODE,
      mouseOnScene: this.STATUS_MOUSE_ON_SCENE,
      mouseOnViewer: this.STATUS_MOUSE_ON_VIEWER,
      recording: false,
      initialRenderDone: this.INITIAL_RENDER_DONE,
      animationPlaying: this.timelineController.isPlayingNow()
    })
  }

  async applyState(
    state: Scene3DState,
    selectedId: string | null
  ): Promise<void> {
    const epoch = ++this.applyStateEpoch
    const selectionEpoch = this.selectionEpoch
    this.primitiveManager.applyPrimitives(state.primitives)
    this.lightManager.applyLights(state.lights)
    this.director.configure(state)
    this.characterManager.setSceneFps(state.output.fps)
    this.idColors = idMatteColorById(state)
    await Promise.all([
      this.characterManager.applyCharacters(state.characters),
      this.customModelManager.applyModels(state.models),
      this.sceneCameraManager.applyCameras(state.cameras)
    ])
    if (epoch !== this.applyStateEpoch) return
    this.environment.apply(state.environment)
    this.objects.applyVisibility(state)
    this.channels.invalidatePose()
    if (
      this.pipCameraId &&
      !this.sceneCameraManager.isCamera(this.pipCameraId)
    ) {
      this.pipCameraId = null
    }
    if (
      this.lookThroughId &&
      !this.sceneCameraManager.isCamera(this.lookThroughId)
    ) {
      this.setLookThroughCamera(null)
    }
    if (selectionEpoch === this.selectionEpoch) {
      this.selected = selectedId
      this.sceneCameraManager.setSelected(selectedId)
    }
    const hovered = this.picker.hoveredId
    if (hovered && !this.getSceneObject(hovered)) {
      this.picker.setHovered(null)
    }
    this.timeline.animationDuration = sceneAnimationDuration(
      state,
      this.characterManager.clipDurations(),
      this.customModelManager.clipDurations(),
      this.characterManager.pathEndSeconds()
    )
    this.timeline.refresh()
    this.gizmo.attach()
    this.pathEditor.sync(this.selected)
    this.syncSceneToTimeline()
    this.forceRender()
  }

  setSelected(id: string | null): void {
    this.selectionEpoch += 1
    this.selected = id
    this.sceneCameraManager.setSelected(id)
    this.gizmo.attach()
    this.pathEditor.sync(this.selected)
    this.forceRender()
  }

  setPlanView(enabled: boolean): void {
    if (this.plan.enabled === enabled) return
    if (enabled && this.lookThroughId) this.setLookThroughCamera(null)
    this.plan.set(enabled)
    this.pathEditor.destroy()
    this.pathEditor.sync(this.selected)
    this.handleResize()
    this.forceRender()
  }

  setCaptureLayers(layers: CaptureLayers | null): void {
    this.captureLayers = layers
  }

  getCaptureLayers(): CaptureLayers | null {
    return this.captureLayers
  }

  setRoomLayerVisibility(walls: boolean, floor: boolean): void {
    this.environment.setRoomLayerVisibility(walls, floor)
  }

  resetRoomLayerVisibility(): void {
    this.environment.resetRoomLayerVisibility()
  }

  getIdMatteColor(id: string): string | undefined {
    return this.idColors.get(id)
  }

  suspendPathEditor(): void {
    this.pathEditor.destroy()
  }

  resumePathEditor(): void {
    this.pathEditor.sync(this.selected)
  }

  refreshTimelineDuration(): void {
    this.timeline.refresh()
  }

  setTimelinePlayIntent(playing: boolean): void {
    this.timeline.setPlayIntent(playing)
  }

  handleCameraPresetLoaded(): void {
    this.timeline.refresh()
    this.environment.refresh()
    this.syncSceneToTimeline()
    this.forceRender()
  }

  setPipCamera(id: string | null): void {
    if (this.pipCameraId === id) return
    this.pipCameraId = id
    this.forceRender()
  }

  pipCamera(): THREE.PerspectiveCamera | null {
    const id = this.pipCameraId ?? (this.director.activeShotCameraId() || null)
    if (!id) return null
    const camera = this.sceneCameraManager.getCamera(id)
    if (!camera) return null
    if (this.getRenderCamera() === camera) return null
    return camera
  }

  setLookThroughCamera(id: string | null): void {
    const camera = id ? this.sceneCameraManager.getCamera(id) : null
    this.lookThroughId = camera ? id : null
    this.sceneCameraManager.setLookThroughId(this.lookThroughId)
    this.setExternalActiveCamera(camera)
    this.gizmo.attach()
    this.handleResize()
  }

  protected override shouldMaintainAspectRatio(): boolean {
    if (this.getRenderCamera() !== this.cameraManager.activeCamera) {
      return super.shouldMaintainAspectRatio()
    }
    return false
  }

  getCaptureCamera(): THREE.Camera {
    if (this.captureCameraOverride) return this.captureCameraOverride
    const cameraId =
      this.director.activeShotCameraId() || this.director.outputCameraId
    const camera = cameraId
      ? this.sceneCameraManager.getCamera(cameraId)
      : null
    return camera ?? this.getRenderCamera()
  }

  setCaptureCameraOverride(id: string | null): void {
    this.captureCameraOverride = id
      ? this.sceneCameraManager.getCamera(id)
      : null
  }

  getEditorCameraPose(): ReturnType<typeof cameraPose> {
    return cameraPose(this.cameraManager.activeCamera)
  }

  openposeRoots(): THREE.Object3D[] {
    return this.objects.openposeRoots()
  }

  contentObjects(): THREE.Object3D[] {
    return this.objects.contentObjects()
  }

  pickables(): THREE.Object3D[] {
    return this.objects.pickables()
  }

  cameraPathBounds(): THREE.Box3 | null {
    return this.sceneCameraManager.getPathBounds()
  }

  setGizmoMode(mode: Scene3dGizmoMode): void {
    this.gizmo.mode = mode
    this.gizmo.attach()
    this.forceRender()
  }

  effectiveGizmoMode(): Scene3dGizmoMode {
    return this.gizmo.effectiveMode()
  }

  refreshGizmo(): void {
    this.gizmo.attach()
  }

  commitGizmoTransform(): void {
    this.gizmo.commitTransform()
  }

  setPreviewChannel(channel: SceneChannel): void {
    if (this.channels.setChannel(channel)) this.forceRender()
  }

  getSceneObject(id: string): THREE.Object3D | null {
    return this.objects.get(id)
  }

  selectedLightEntry(): SceneLightEntry | null {
    if (!this.selected) return null
    return this.lightManager.getEntry(this.selected)
  }

  renderRegionSize(): { clientWidth: number; clientHeight: number } {
    const canvas = this.domElement
    if (!this.shouldMaintainAspectRatio()) {
      return { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight }
    }
    const { width, height } = computeLetterboxedViewport(
      { width: canvas.clientWidth, height: canvas.clientHeight },
      this.targetAspectRatio
    )
    return { clientWidth: width, clientHeight: height }
  }

  setEditorHelpersVisible(visible: boolean): void {
    this.environment.setGridVisible(visible)
    this.lightManager.setMarkersVisible(visible)
    this.sceneCameraManager.setHelpersVisible(visible)
    this.characterManager.setHelpersVisible(visible)
    this.gizmoManager.setHelperVisible(visible)
    this.picker.setBoxVisible(visible)
    if (visible) {
      this.lightHandles.sync()
    } else {
      this.lightHandles.hide()
    }
  }

  override renderMainScene(): void {
    this.channels.render(this.capturing)
  }

  renderColorScene(): void {
    super.renderMainScene()
  }

  protected override onActiveCameraChanged(): void {
    this.gizmoManager.updateCamera(this.cameraManager.activeCamera)
    this.lightHandles.updateCamera(this.cameraManager.activeCamera)
  }

  override remove(): void {
    this.pointer.dispose()
    super.remove()
  }

  protected override disposeManagers(): void {
    this.pathEditor.destroy()
    super.disposeManagers()
    this.customModelManager.dispose()
    this.environment.dispose()
    this.lightHandles.dispose()
    this.picker.dispose()
    this.channels.dispose()
    this.characterManager.dispose()
    this.primitiveManager.dispose()
    this.lightManager.dispose()
    this.sceneCameraManager.dispose()
    this.gizmoManager.dispose()
  }

  override prepareMainViewport(): void {
    super.prepareMainViewport()
    const render = this.getRenderCamera()
    if (
      render !== this.cameraManager.activeCamera &&
      render instanceof THREE.PerspectiveCamera
    ) {
      const aspect =
        this.targetAspectRatio ??
        this.view.width / Math.max(1, this.view.height)
      if (Math.abs(render.aspect - aspect) > 1e-6) {
        render.aspect = aspect
        render.updateProjectionMatrix()
      }
    }
  }
}
