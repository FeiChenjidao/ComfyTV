import type {
  CharacterAnimationConfig,
  Scene3DState,
  SceneCharacterEntry
} from './types'

export function characterElapsedTime(
  timelineSeconds: number,
  animation: CharacterAnimationConfig
): number {
  return animation.startOffset + timelineSeconds * animation.speed
}

export function clipLocalTime(
  elapsed: number,
  duration: number,
  loop: boolean
): number {
  if (duration <= 0) return 0
  if (loop) {
    return ((elapsed % duration) + duration) % duration
  }
  return Math.min(Math.max(elapsed, 0), duration)
}

export function actionSampleTime(
  elapsed: number,
  duration: number,
  loop: boolean
): number {
  const local = clipLocalTime(elapsed, duration, loop)
  if (!loop && duration > 0 && local >= duration) {
    return Math.max(0, duration - 1e-4)
  }
  return local
}

export function sceneFallbackDuration(
  characters: readonly Pick<SceneCharacterEntry, 'model' | 'animation'>[],
  clipDurations: ReadonlyMap<string, number>
): number {
  let longest = 0
  for (const character of characters) {
    const duration =
      clipDurations.get(`${character.model}:${character.animation.clip}`) ?? 0
    if (duration <= 0) continue
    longest = Math.max(longest, duration / character.animation.speed)
  }
  return Math.max(longest, 1)
}

export function sceneAnimationDuration(
  state: Pick<Scene3DState, 'characters' | 'models'>,
  characterClips: ReadonlyMap<string, number>,
  modelClips: ReadonlyMap<string, number>,
  pathEndSeconds: number
): number {
  const animatedModels = state.models.filter(
    (model) => model.animation.clip !== ''
  )
  if (!state.characters.length && !animatedModels.length) return 0
  return Math.max(
    sceneFallbackDuration(state.characters, characterClips),
    sceneFallbackDuration(
      animatedModels.map((model) => ({
        model: model.url,
        animation: model.animation
      })),
      modelClips
    ),
    pathEndSeconds
  )
}
