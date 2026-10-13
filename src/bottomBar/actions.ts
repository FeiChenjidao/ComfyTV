import { listNativeWorkflows, type NativeWorkflow } from '@/api'
import { stageDisplayName } from '@/composables/sidebar/usePresetsPanel'
import { canvasCenter, selectOnCanvas } from '@/composables/stages/assetLoaderNode'
import { createNodeAt } from '@/composables/stages/spawnFollowUp'
import { loadStageMeta } from '@/composables/stages/stageMeta'
import { tryOpenNativeWorkflowInComfy } from '@/composables/useOpenInComfy'

import { openComfyTVSidebar } from './sidebarTabBridge'

export const QUICK_CREATE: Array<{ id: string; classType: string; labelKey: string }> = [
  { id: 'image', classType: 'ComfyTV.ImageStage', labelKey: 'v2.bottomBar.createImage' },
  { id: 'video', classType: 'ComfyTV.VideoStage', labelKey: 'v2.bottomBar.createVideo' },
  { id: 'audio', classType: 'ComfyTV.AudioStage', labelKey: 'v2.bottomBar.createAudio' },
  { id: 'text', classType: 'ComfyTV.TextStage', labelKey: 'v2.bottomBar.createText' },
]

export function openAssetsLibrary(): void {
  openComfyTVSidebar('assets')
}

export function spawnStageAtCenter(classType: string): any | null {
  const node = createNodeAt(classType, canvasCenter())
  if (!node) return null
  selectOnCanvas(node)
  return node
}

export type SearchCategoryId =
  | 'generate'
  | 'input'
  | 'image'
  | 'edit'
  | 'video'
  | 'audio'
  | 'text'
  | 'model3d'
  | 'bridge'
  | 'utils'
  | 'other'

/** Chips in the search panel (excluding `all`, handled in UI). */
export const SEARCH_CATEGORY_IDS: SearchCategoryId[] = [
  'generate',
  'input',
  'image',
  'edit',
  'video',
  'audio',
  'text',
  'model3d',
  'bridge',
  'utils',
  'other',
]

export interface NodeCatalogEntry {
  classType: string
  label: string
  kind?: string
  variant?: string | null
  category: SearchCategoryId
}

function liteGraphMenuCategory(classType: string): string | undefined {
  const def = (window as any)?.LiteGraph?.registered_node_types?.[classType]
  const cat = def?.category
  return typeof cat === 'string' ? cat : undefined
}

const MENU_SEGMENT_TO_CATEGORY: Record<string, SearchCategoryId> = {
  Generate: 'generate',
  Input: 'input',
  Image: 'image',
  Video: 'video',
  VideoFX: 'video',
  Compose: 'video',
  Keying: 'video',
  Audio: 'audio',
  AudioFX: 'audio',
  Music: 'audio',
  Panorama: 'image',
  '3D': 'model3d',
  Utils: 'utils',
  Bridge: 'bridge',
  Project: 'other',
}

export function categoryFromMenuPath(menuCategory: string | undefined): SearchCategoryId {
  if (!menuCategory) return 'other'
  const seg = menuCategory.replace(/^ComfyTV\/?/i, '').split('/')[0] || ''
  return MENU_SEGMENT_TO_CATEGORY[seg] ?? 'other'
}

export function inferSearchCategory(
  classType: string,
  kind?: string,
  variant?: string | null,
  menuCategory?: string,
): SearchCategoryId {
  if (menuCategory) {
    const mapped = categoryFromMenuPath(menuCategory)
    if (mapped !== 'other') return mapped
  }
  const short = classType.replace(/^ComfyTV\./, '')
  if (/^Bridge/i.test(short)) return 'bridge'
  if (variant === 'loader' || /LoaderStage$/i.test(short)) return 'input'
  if (variant === 'transform') return 'edit'
  if (
    /^(Text|Image|Video|Audio|Speech|Model3D|ShotImages|Storyboard|Custom)Stage$/i.test(short)
    || variant === 'generator'
  ) {
    return 'generate'
  }
  const k = kind || ''
  if (k === 'text' || k.endsWith('-picker') && k.startsWith('text')) return 'text'
  if (k.includes('audio')) return 'audio'
  if (k === 'video' || k === 'timeline' || k === 'storyboard') return 'video'
  if (k === 'model' || k === 'material') return 'model3d'
  if (k.includes('image') || k === 'panorama') return 'image'
  if (/^Video/i.test(short) || /Stage$/.test(short) && /Video|Director|Timeline|Fx|Subtitle|SceneDetect/i.test(short)) {
    return 'video'
  }
  if (/^Audio/i.test(short) || /Midi|Score|Speech|Music/i.test(short)) return 'audio'
  if (/Mesh|Model|Blender|Material|LineArt|Poster|Scene3D/i.test(short)) return 'model3d'
  if (/Crop|Rotate|Mirror|Split|Merge|Grade|Compare|Inpaint|Outpaint|Upscale|Edit|Erase|Cutout/i.test(short)) {
    return 'edit'
  }
  return categoryFromMenuPath(menuCategory)
}

function buildCatalogEntry(
  nodeId: string,
  meta?: { kind: string; variant?: string | null },
): NodeCatalogEntry {
  const menu = liteGraphMenuCategory(nodeId)
  return {
    classType: nodeId,
    label: stageDisplayName(nodeId),
    kind: meta?.kind,
    variant: meta?.variant ?? null,
    category: inferSearchCategory(nodeId, meta?.kind, meta?.variant, menu),
  }
}

export async function listComfyTVNodes(): Promise<NodeCatalogEntry[]> {
  const stages = await loadStageMeta()
  const fromMeta: NodeCatalogEntry[] = []
  for (const [nodeId, meta] of stages) {
    if (!nodeId.startsWith('ComfyTV.')) continue
    if (nodeId === 'ComfyTV.ProjectStage') continue
    fromMeta.push(buildCatalogEntry(nodeId, meta))
  }
  if (fromMeta.length) {
    return fromMeta.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }

  // Fallback: LiteGraph registry when stage meta is unavailable
  const types = (window as any)?.LiteGraph?.registered_node_types || {}
  const out: NodeCatalogEntry[] = []
  for (const key of Object.keys(types)) {
    if (!key.startsWith('ComfyTV.') || key === 'ComfyTV.ProjectStage') continue
    out.push(buildCatalogEntry(key))
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export function filterNodes(
  nodes: NodeCatalogEntry[],
  query: string,
  category: SearchCategoryId | 'all' = 'all',
): NodeCatalogEntry[] {
  let list = nodes
  if (category !== 'all') {
    list = list.filter((n) => n.category === category)
  }
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((n) => {
    const hay = `${n.label} ${n.classType} ${n.kind || ''} ${n.category}`.toLowerCase()
    return hay.includes(q)
  })
}

export interface NodeCatalogGroup {
  id: SearchCategoryId
  labelKey: string
  nodes: NodeCatalogEntry[]
}

export function groupNodesByCategory(nodes: NodeCatalogEntry[]): NodeCatalogGroup[] {
  const buckets = new Map<SearchCategoryId, NodeCatalogEntry[]>()
  for (const n of nodes) {
    const arr = buckets.get(n.category) || []
    arr.push(n)
    buckets.set(n.category, arr)
  }
  const groups: NodeCatalogGroup[] = []
  for (const id of SEARCH_CATEGORY_IDS) {
    const list = buckets.get(id)
    if (!list?.length) continue
    list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    groups.push({ id, labelKey: `v2.bottomBar.cat.${id}`, nodes: list })
  }
  return groups
}

/** Folder badge for a path under user/default/workflows ('' if at root). */
export function nativeWorkflowFolder(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

/**
 * Bottom-bar “Workflows” = ComfyUI native library (user/default/workflows),
 * not ComfyTV stage dropdown entries under user/comfytv/workflows.
 */
export async function listBottomBarWorkflows(): Promise<NativeWorkflow[]> {
  const rows = await listNativeWorkflows()
  return [...rows].sort((a, b) => {
    const fa = nativeWorkflowFolder(a.path)
    const fb = nativeWorkflowFolder(b.path)
    if (fa !== fb) return fa.localeCompare(fb, undefined, { sensitivity: 'base' })
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      || b.mtime - a.mtime
  })
}

export async function openWorkflowRow(row: NativeWorkflow): Promise<boolean> {
  return tryOpenNativeWorkflowInComfy(row.path)
}
