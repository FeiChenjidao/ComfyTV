import * as THREE from 'three'

import type { SceneChannel } from '../capture/channelRender'
import {
  PosePreview,
  createDepthPreviewMaterial,
  updateDepthPreviewRange
} from '../livePreview'

export interface ChannelPreviewHost {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  targetAspectRatio: number
  viewSize(): { width: number; height: number }
  getRenderCamera(): THREE.Camera
  prepareMainViewport(): void
  renderColorScene(): void
  setEditorHelpersVisible(visible: boolean): void
  openposeRoots(): THREE.Object3D[]
  contentObjects(): THREE.Object3D[]
  pipCamera(): THREE.PerspectiveCamera | null
}

export class ChannelPreviewRenderer {
  channel: SceneChannel = 'color'
  private readonly posePreview = new PosePreview()
  private readonly depthPreviewMaterial = createDepthPreviewMaterial()
  private readonly normalPreviewMaterial = new THREE.MeshNormalMaterial({
    side: THREE.DoubleSide
  })

  constructor(private readonly host: ChannelPreviewHost) {}

  setChannel(channel: SceneChannel): boolean {
    if (this.channel === channel) return false
    this.channel = channel
    return true
  }

  invalidatePose(): void {
    this.posePreview.invalidateCache()
  }

  render(capturing: boolean): void {
    this.renderMainChannel(capturing)
    if (!capturing) this.renderCameraPip()
  }

  private renderMainChannel(capturing: boolean): void {
    const channel = this.channel
    if (channel === 'color' || capturing) {
      this.host.renderColorScene()
      return
    }

    this.host.prepareMainViewport()
    const renderer = this.host.renderer
    const camera = this.host.getRenderCamera()
    const previousClearColor = renderer.getClearColor(new THREE.Color())
    const previousClearAlpha = renderer.getClearAlpha()
    this.host.setEditorHelpersVisible(false)
    try {
      this.renderChannelPass(camera, channel)
    } finally {
      this.host.setEditorHelpersVisible(true)
      renderer.setClearColor(previousClearColor, previousClearAlpha)
    }
  }

  private renderChannelPass(camera: THREE.Camera, channel: SceneChannel): void {
    const renderer = this.host.renderer
    const scene = this.host.scene
    if (channel === 'openpose') {
      this.posePreview.update(this.host.openposeRoots())
      renderer.setClearColor(0x000000, 1)
      renderer.clear()
      renderer.render(this.posePreview.scene, camera)
      return
    }
    const previousOverride = scene.overrideMaterial
    try {
      if (channel === 'normal') {
        scene.overrideMaterial = this.normalPreviewMaterial
        renderer.setClearColor(new THREE.Color(0.5, 0.5, 1.0), 1)
      } else {
        updateDepthPreviewRange(
          this.depthPreviewMaterial,
          camera,
          this.host.contentObjects()
        )
        scene.overrideMaterial = this.depthPreviewMaterial
        renderer.setClearColor(0x000000, 1)
      }
      renderer.clear()
      renderer.render(scene, camera)
    } finally {
      scene.overrideMaterial = previousOverride
    }
  }

  private renderCameraPip(): void {
    const camera = this.host.pipCamera()
    if (!camera) return

    const renderer = this.host.renderer
    const { width: cw, height: ch } = this.host.viewSize()
    if (cw < 120 || ch < 90) return
    const aspect = this.host.targetAspectRatio ?? cw / ch
    let pipWidth = Math.round(cw * 0.32)
    let pipHeight = Math.round(pipWidth / aspect)
    const maxHeight = Math.round(ch * 0.38)
    if (pipHeight > maxHeight) {
      pipHeight = maxHeight
      pipWidth = Math.round(pipHeight * aspect)
    }
    if (pipWidth < 48 || pipHeight < 32) return
    const margin = 10
    const x = cw - pipWidth - margin
    const y = margin

    if (Math.abs(camera.aspect - aspect) > 1e-6) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    }

    const previousClearColor = renderer.getClearColor(new THREE.Color())
    const previousClearAlpha = renderer.getClearAlpha()
    this.host.setEditorHelpersVisible(false)
    try {
      renderer.setViewport(x, y, pipWidth, pipHeight)
      renderer.setScissor(x, y, pipWidth, pipHeight)
      renderer.setScissorTest(true)
      if (this.channel === 'color') {
        renderer.setClearColor(0x111118, 1)
        renderer.clear()
        renderer.render(this.host.scene, camera)
      } else {
        this.renderChannelPass(camera, this.channel)
      }
    } finally {
      this.host.setEditorHelpersVisible(true)
      renderer.setClearColor(previousClearColor, previousClearAlpha)
    }
  }

  dispose(): void {
    this.posePreview.dispose()
    this.depthPreviewMaterial.dispose()
    this.normalPreviewMaterial.dispose()
  }
}
