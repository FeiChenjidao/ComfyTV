import type { Asset } from '@/api/schemas'
import { isSplatLikeModelUrl } from '@/widgets/three/modelFormats'
import type { LightPresetName } from '@/widgets/three/scene3d/lightPresets'
import { createLightPreset } from '@/widgets/three/scene3d/lightPresets'
import { computeModelFit, needsAutoFit } from '@/widgets/three/scene3d/modelFit'
import {
  getCharacterClipNames,
  loadCustomModelAssets
} from '@/widgets/three/scene3d/scene3dAssets'
import type {
  CharacterAnimationConfig,
  CharacterTransform,
  PrimitiveShape,
  SceneEnvironmentConfig,
  SceneLightEntry,
  SceneLightType,
  ScenePrimitiveEntry
} from '@/widgets/three/scene3d/types'
import {
  cloneScene,
  createDefaultCharacter,
  createDefaultLight,
  createDefaultModel,
  createDefaultPrimitive
} from '@/widgets/three/scene3d/types'

import {
  allIds,
  findLabelEntry,
  firstSceneId,
  patchMergeKey,
  toastError,
  tr,
  type Scene3dStageCore
} from './scene3dStageCore'

export function useScene3dObjects(core: Scene3dStageCore) {
  const { state, selectedId } = core

  async function addCharacter(model: string): Promise<void> {
    const character = createDefaultCharacter(model, allIds(state.value))
    try {
      const clipNames = await getCharacterClipNames(model)
      character.animation.clip = clipNames[0] ?? ''
    } catch {
      toastError(tr('scene3d.failedToLoadAssets'))
      return
    }
    const next = cloneScene(state.value)
    next.characters.push(character)
    selectedId.value = character.id
    core.commit(next)
  }

  function addPrimitive(shape: PrimitiveShape): void {
    const primitive = createDefaultPrimitive(shape, allIds(state.value))
    const next = cloneScene(state.value)
    next.primitives.push(primitive)
    selectedId.value = primitive.id
    core.commit(next)
  }

  async function addModelFromAsset(asset: Asset): Promise<void> {
    const model = createDefaultModel(
      asset.payload_url,
      asset.name || 'model',
      allIds(state.value)
    )
    if (!isSplatLikeModelUrl(asset.payload_url)) {
      try {
        const assets = await loadCustomModelAssets(asset.payload_url)
        model.animation.clip = assets.clips[0]?.name ?? ''
        const fit = computeModelFit(assets.template)
        if (fit && needsAutoFit(fit.maxDim)) model.transform = fit.transform
      } catch (error) {
        console.error('[ComfyTV/scene3d] failed to load model asset', error)
        toastError(tr('scene3d.failedToLoadModelAsset'))
        return
      }
    }
    const next = cloneScene(state.value)
    next.models.push(model)
    selectedId.value = model.id
    core.commit(next)
  }

  async function fitSelectedModel(): Promise<void> {
    const model =
      state.value.models.find((entry) => entry.id === selectedId.value) ?? null
    if (!model || isSplatLikeModelUrl(model.url)) return
    try {
      const assets = await loadCustomModelAssets(model.url)
      const fit = computeModelFit(assets.template)
      if (fit) commitTransform(model.id, fit.transform)
    } catch (error) {
      console.error('[ComfyTV/scene3d] failed to fit model', error)
      toastError(tr('scene3d.failedToLoadModelAsset'))
    }
  }

  function addLight(type: SceneLightType): void {
    const light = createDefaultLight(type, allIds(state.value))
    const next = cloneScene(state.value)
    next.lights.push(light)
    selectedId.value = light.id
    core.commit(next)
  }

  function applyLightPreset(name: LightPresetName): void {
    const next = cloneScene(state.value)
    next.lights = createLightPreset(name, [
      ...next.characters.map((entry) => entry.id),
      ...next.primitives.map((entry) => entry.id),
      ...next.models.map((entry) => entry.id),
      ...next.cameras.map((entry) => entry.id)
    ])
    if (state.value.lights.some((light) => light.id === selectedId.value)) {
      selectedId.value = next.lights[0]?.id ?? null
    }
    core.commit(next)
  }

  function removeSelected(): void {
    const id = selectedId.value
    if (!id) return
    const next = cloneScene(state.value)
    next.characters = next.characters.filter((entry) => entry.id !== id)
    next.primitives = next.primitives.filter((entry) => entry.id !== id)
    next.models = next.models.filter((entry) => entry.id !== id)
    next.lights = next.lights.filter((entry) => entry.id !== id)
    next.cameras = next.cameras.filter((entry) => entry.id !== id)
    next.shots = next.shots.filter((entry) => entry.id !== id)
    next.promptTrack = next.promptTrack.filter((entry) => entry.id !== id)
    for (const shot of next.shots) {
      if (shot.cameraId === id) shot.cameraId = ''
      if (shot.lock === id) delete shot.lock
    }
    if (next.output.cameraId === id) {
      next.output.cameraId = next.cameras[0]?.id ?? ''
    }
    selectedId.value = firstSceneId(next)
    core.commit(next)
  }

  function renameObject(id: string, name: string): void {
    const next = cloneScene(state.value)
    const entry = findLabelEntry(next, id)
    if (!entry) return
    entry.name = name.trim()
    core.commit(next, `rename:${id}`)
  }

  function setObjectHidden(id: string, hidden: boolean): void {
    const next = cloneScene(state.value)
    const entry = findLabelEntry(next, id)
    if (!entry) return
    entry.hidden = hidden
    core.commit(next)
  }

  function toggleObjectHidden(id: string): void {
    setObjectHidden(id, !findLabelEntry(state.value, id)?.hidden)
  }

  function updateSelectedAnimation(
    patch: Partial<CharacterAnimationConfig>
  ): void {
    const id = selectedId.value
    if (!id) return
    updateCharacterAnimationById(id, patch)
  }

  function updateCharacterAnimationById(
    id: string,
    patch: Partial<CharacterAnimationConfig>
  ): void {
    const next = cloneScene(state.value)
    const target =
      next.characters.find((entry) => entry.id === id) ??
      next.models.find((entry) => entry.id === id)
    if (!target) return
    target.animation = { ...target.animation, ...patch }
    core.commit(next, `animation:${id}:${patchMergeKey(patch)}`)
  }

  function setCharacterColorById(id: string, color: string): void {
    const next = cloneScene(state.value)
    const target = next.characters.find((entry) => entry.id === id)
    if (!target) return
    if (color) target.color = color
    else delete target.color
    core.commit(next, `charcolor:${id}`)
  }

  function updateSelectedTransform(transform: CharacterTransform): void {
    const id = selectedId.value
    if (!id) return
    commitTransform(id, transform)
  }

  function updateSelectedPrimitive(
    patch: Partial<Pick<ScenePrimitiveEntry, 'color'>>
  ): void {
    const id = selectedId.value
    if (!id) return
    const next = cloneScene(state.value)
    const primitive = next.primitives.find((entry) => entry.id === id)
    if (!primitive) return
    Object.assign(primitive, patch)
    core.commit(next, `primitive:${id}:${patchMergeKey(patch)}`)
  }

  function updateSelectedLight(patch: Partial<SceneLightEntry>): void {
    const id = selectedId.value
    if (!id) return
    patchLightById(id, patch)
  }

  function patchLightById(id: string, patch: Partial<SceneLightEntry>): void {
    const next = cloneScene(state.value)
    const index = next.lights.findIndex((entry) => entry.id === id)
    if (index < 0) return
    next.lights[index] = { ...next.lights[index], ...patch, id }
    core.commit(next, `light:${id}:${patchMergeKey(patch)}`)
  }

  function updateEnvironment(patch: Partial<SceneEnvironmentConfig>): void {
    const next = cloneScene(state.value)
    next.environment = { ...next.environment, ...patch }
    core.commit(next, `environment:${patchMergeKey(patch)}`)
  }

  function commitTransform(id: string, transform: CharacterTransform): void {
    const mergeKey = `transform:${id}`
    const next = cloneScene(state.value)
    const light = next.lights.find((entry) => entry.id === id)
    if (light) {
      light.position = { ...transform.position }
      core.commit(next, mergeKey)
      return
    }
    const camera = next.cameras.find((entry) => entry.id === id)
    if (camera) {
      camera.transform = {
        position: { ...transform.position },
        quaternion: { ...transform.quaternion }
      }
      camera.preset = null
      core.commit(next, mergeKey)
      return
    }
    const target =
      next.characters.find((entry) => entry.id === id) ??
      next.primitives.find((entry) => entry.id === id) ??
      next.models.find((entry) => entry.id === id)
    if (!target) return
    target.transform = transform
    core.commit(next, mergeKey)
  }

  return {
    addCharacter,
    addPrimitive,
    addModelFromAsset,
    fitSelectedModel,
    addLight,
    applyLightPreset,
    removeSelected,
    renameObject,
    toggleObjectHidden,
    updateSelectedAnimation,
    updateCharacterAnimationById,
    setCharacterColorById,
    updateSelectedTransform,
    updateSelectedPrimitive,
    updateSelectedLight,
    patchLightById,
    updateEnvironment,
    commitTransform
  }
}
