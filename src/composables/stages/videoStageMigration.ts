import type { LGraphNode } from '@/lib/comfyApp'

const VIDEO_MODES = new Set(['文生视频', '图生视频', '首尾帧', '全能参考'])
const DEFAULT_MODE = '文生视频'
const DEFAULT_RESOLUTION = '720P'
const DEFAULT_ASPECT_RATIO = '16:9'
const DEFAULT_DURATION_S = 5
const MIN_DURATION_S = 1
const MAX_DURATION_S = 120

type ConfigureInfo = { widgets_values?: unknown[] }

function widgetIndex(node: LGraphNode, name: string): number {
  return (node.widgets ?? []).findIndex(widget => widget.name === name)
}

function looksLikeResolution(value: unknown): boolean {
  return /^(?:\d+P|\d+K)$/i.test(String(value ?? ''))
}

function looksLikeAspectRatio(value: unknown): boolean {
  return /^(?:auto|adaptive|\d+:\d+)$/i.test(String(value ?? ''))
}

function looksLikeJsonObject(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function normalizeResolution(value: unknown): unknown {
  const raw = String(value ?? '')
  if (!/^\d+p$/i.test(raw)) return value
  return raw.toUpperCase()
}

function normalizeDuration(value: unknown): number {
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration < MIN_DURATION_S || duration > MAX_DURATION_S) {
    return DEFAULT_DURATION_S
  }
  return Math.round(duration)
}

export function migrateVideoStageConfigureInfo(
  node: LGraphNode,
  info: ConfigureInfo | null | undefined,
): boolean {
  const values = info?.widgets_values
  if (!Array.isArray(values)) return false

  const resolutionIndex = widgetIndex(node, 'resolution')
  const aspectIndex = widgetIndex(node, 'aspect_ratio')
  const durationIndex = widgetIndex(node, 'duration_s')
  const audioIndex = widgetIndex(node, 'generate_audio')
  const promptIndex = widgetIndex(node, 'main_prompt')
  const customIndex = widgetIndex(node, 'custom_params')
  const modeIndex = widgetIndex(node, 'mode')
  const indexes = [
    resolutionIndex,
    aspectIndex,
    durationIndex,
    audioIndex,
    promptIndex,
    customIndex,
    modeIndex,
  ]
  if (indexes.some(index => index < 0)) return false

  let changed = false
  let rotated = false
  const interimLayout = values.length > modeIndex && (
    VIDEO_MODES.has(String(values[resolutionIndex] ?? ''))
    || (
      looksLikeResolution(values[aspectIndex])
      && looksLikeAspectRatio(values[durationIndex])
    )
  )

  if (interimLayout) {
    const mode = values[resolutionIndex]
    for (let index = resolutionIndex; index < modeIndex; index++) {
      values[index] = values[index + 1]
    }
    values[modeIndex] = mode
    changed = true
    rotated = true
  }

  if (
    rotated
    && typeof values[audioIndex] === 'string'
    && looksLikeJsonObject(values[promptIndex])
  ) {
    const recoveredPrompt = values[audioIndex]
    const recoveredCustomParams = values[promptIndex]
    values[audioIndex] = false
    values[promptIndex] = recoveredPrompt
    values[customIndex] = recoveredCustomParams
    changed = true
  }

  const resolution = normalizeResolution(values[resolutionIndex])
  if (resolution !== values[resolutionIndex]) {
    values[resolutionIndex] = resolution
    changed = true
  }

  if (String(values[aspectIndex] ?? '') === 'adaptive') {
    values[aspectIndex] = 'auto'
    changed = true
  }

  const duration = normalizeDuration(values[durationIndex])
  if (duration !== values[durationIndex]) {
    values[durationIndex] = duration
    changed = true
  }

  if (values[audioIndex] !== true && values[audioIndex] !== false) {
    values[audioIndex] = values[audioIndex] === 1
    changed = true
  }

  if (values.length > modeIndex && !VIDEO_MODES.has(String(values[modeIndex] ?? ''))) {
    values[modeIndex] = DEFAULT_MODE
    changed = true
  }

  return changed
}

export function normalizeVideoStageWidgets(node: LGraphNode): void {
  const resolution = node.widgets?.find(widget => widget.name === 'resolution')
  const aspect = node.widgets?.find(widget => widget.name === 'aspect_ratio')
  const duration = node.widgets?.find(widget => widget.name === 'duration_s')
  const audio = node.widgets?.find(widget => widget.name === 'generate_audio')
  const mode = node.widgets?.find(widget => widget.name === 'mode')

  if (resolution) resolution.value = normalizeResolution(resolution.value) || DEFAULT_RESOLUTION
  if (aspect && String(aspect.value ?? '') === 'adaptive') aspect.value = 'auto'
  if (aspect && !String(aspect.value ?? '')) aspect.value = DEFAULT_ASPECT_RATIO
  if (duration) duration.value = normalizeDuration(duration.value)
  if (audio && audio.value !== true && audio.value !== false) audio.value = audio.value === 1
  if (mode && !VIDEO_MODES.has(String(mode.value ?? ''))) mode.value = DEFAULT_MODE
}
