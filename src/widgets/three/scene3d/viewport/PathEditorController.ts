import type * as THREE from 'three'
import { ScenePathEditor } from 'dollycurve'

import type { Scene3dCharacterManager } from '../CharacterManager'

export interface PathEditorHost {
  scene: THREE.Scene
  canvas: HTMLCanvasElement
  characterManager: Scene3dCharacterManager
  events: { onPathCommit?(id: string, label: string): void }
  getRenderCamera(): THREE.Camera
  syncSceneToTimeline(): void
  forceRender(): void
}

export class PathEditorController {
  private editor: ScenePathEditor | null = null
  private characterId: string | null = null
  private path: unknown = null
  dragging = false

  constructor(private readonly host: PathEditorHost) {}

  pick(clientX: number, clientY: number): boolean {
    return Boolean(this.editor?.pick(clientX, clientY))
  }

  sync(selectedId: string | null): void {
    const id = selectedId
    const parsed = id ? this.host.characterManager.getParsedPath(id) : null
    if (!parsed || !id) {
      this.destroy()
      return
    }
    if (this.characterId === id && this.path === parsed.path) {
      this.editor?.refresh()
      return
    }
    this.destroy()
    this.characterId = id
    this.path = parsed.path
    this.host.characterManager.setPathLineSuppressed(id, true)
    this.editor = new ScenePathEditor(parsed.path, {
      path: parsed.path,
      scene: this.host.scene,
      camera: this.host.getRenderCamera(),
      dom: this.host.canvas,
      anchorRadius: 0.11,
      onChanged: () => {
        this.host.characterManager.invalidatePath(id)
        this.host.syncSceneToTimeline()
        this.host.forceRender()
      },
      onCommit: (label) => {
        this.host.events.onPathCommit?.(id, label)
      }
    })
  }

  destroy(): void {
    if (this.characterId) {
      this.host.characterManager.setPathLineSuppressed(this.characterId, false)
    }
    this.editor?.destroy()
    this.editor = null
    this.characterId = null
    this.path = null
    this.dragging = false
  }
}
