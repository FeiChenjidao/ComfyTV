import type * as THREE from 'three'

import type { Scene3dCharacterManager } from '../CharacterManager'
import type { Scene3dCustomModelManager } from '../CustomModelManager'
import type { Scene3dLightManager } from '../LightManager'
import type { Scene3dPrimitiveManager } from '../PrimitiveManager'
import type { SceneCameraManager } from '../SceneCameraManager'
import type { Scene3DState } from '../types'

export interface SceneObjectManagers {
  characterManager: Scene3dCharacterManager
  primitiveManager: Scene3dPrimitiveManager
  customModelManager: Scene3dCustomModelManager
  lightManager: Scene3dLightManager
  sceneCameraManager: SceneCameraManager
}

export class SceneObjectIndex {
  constructor(private readonly m: SceneObjectManagers) {}

  get(id: string): THREE.Object3D | null {
    return (
      this.m.characterManager.getObject(id) ??
      this.m.primitiveManager.getObject(id) ??
      this.m.customModelManager.getObject(id) ??
      this.m.lightManager.getObject(id) ??
      this.m.sceneCameraManager.getObject(id)
    )
  }

  openposeRoots(): THREE.Object3D[] {
    return [
      ...this.m.characterManager.pickables(),
      ...this.m.customModelManager.pickables()
    ]
  }

  contentObjects(): THREE.Object3D[] {
    return [
      ...this.m.characterManager.pickables(),
      ...this.m.primitiveManager.pickables(),
      ...this.m.customModelManager.pickables()
    ]
  }

  pickables(): THREE.Object3D[] {
    return [
      ...this.contentObjects(),
      ...this.m.lightManager.pickables(),
      ...this.m.sceneCameraManager.pickables()
    ]
  }

  applyVisibility(state: Scene3DState): void {
    const entries = [
      ...state.characters,
      ...state.primitives,
      ...state.models,
      ...state.lights,
      ...state.cameras
    ]
    for (const entry of entries) {
      const object = this.get(entry.id)
      if (object) object.visible = !entry.hidden
    }
  }
}
