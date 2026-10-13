import type { ComfyNode } from '@/lib/comfyApp'
import { isImageOutputKind } from '@/v2/imageToolbar'
import type { IslandGroup } from '@/v2/islands'
import {
  attachConfiguredToolbar,
  type NodeToolbarConfig,
  type VideoToolbarFlavor,
} from '@/v2/nodeToolbar'
import type { StageKind, StageState } from '@/stores/stageStore'

export type { VideoToolbarFlavor }
export type { MediaToolbarFlavor } from '@/v2/MediaToolbarV2.vue'
export type { NodeToolbarConfig, NodeToolbarItem, NodeToolbarAction } from '@/v2/nodeToolbar'

export function isVideoOutputKind(kind: StageKind): boolean {
  return kind === 'video' || kind === 'video-picker'
}

export function isAudioOutputKind(kind: StageKind): boolean {
  return kind === 'audio' || kind === 'audio-picker'
}

export function hasOutputToolbar(kind: StageKind): boolean {
  return isImageOutputKind(kind) || isVideoOutputKind(kind) || isAudioOutputKind(kind)
}

/**
 * Attach the floating `.v2-toolbar`. Pass `toolbar` to override the kind default
 * with a preset (`'image'|'video'|'audio'|'none'`) or an explicit 配表.
 */
export function attachOutputToolbar(
  node: ComfyNode,
  card: HTMLElement,
  kind: StageKind,
  state: StageState,
  onAction: (actionId: string, context?: any) => void,
  opts: {
    video?: VideoToolbarFlavor
    toolbar?: NodeToolbarConfig
    islands?: IslandGroup
  } = {},
) {
  return attachConfiguredToolbar({
    node,
    card,
    kind,
    state,
    onAction,
    toolbar: opts.toolbar,
    videoFlavor: opts.video,
    islands: opts.islands,
  })
}
