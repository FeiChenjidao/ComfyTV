import { describe, expect, it, vi } from 'vitest'

import * as stageMeta from '@/composables/stages/stageMeta'
import {
  categoryFromMenuPath,
  filterNodes,
  groupNodesByCategory,
  inferSearchCategory,
  listComfyTVNodes,
  nativeWorkflowFolder,
  openWorkflowTemplateRow,
  QUICK_CREATE,
} from './actions'

describe('bottomBar actions', () => {
  it('exposes the five quick-create stages', () => {
    expect(QUICK_CREATE.map((x) => x.id)).toEqual(['image', 'video', 'audio', 'text', 'model'])
    expect(QUICK_CREATE.map((x) => x.classType)).toEqual([
      'ComfyTV.ImageStage',
      'ComfyTV.VideoStage',
      'ComfyTV.AudioStage',
      'ComfyTV.TextStage',
      'ComfyTV.Model3DStage',
    ])
  })

  it('filters catalog by label or class', () => {
    const nodes = [
      { classType: 'ComfyTV.ImageStage', label: '图像阶段', kind: 'image', category: 'generate' as const },
      { classType: 'ComfyTV.ImagesSplitStage', label: '图像组分离', kind: 'image', category: 'edit' as const },
      { classType: 'ComfyTV.VideoStage', label: '视频阶段', kind: 'video', category: 'generate' as const },
      { classType: 'ComfyTV.VideoCropStage', label: '视频裁剪', kind: 'video', category: 'video' as const },
    ]
    expect(filterNodes(nodes, '分离').map((n) => n.classType)).toEqual(['ComfyTV.ImagesSplitStage'])
    expect(filterNodes(nodes, 'videostage').map((n) => n.classType)).toEqual(['ComfyTV.VideoStage'])
    expect(filterNodes(nodes, '', 'video').map((n) => n.classType)).toEqual(['ComfyTV.VideoCropStage'])
    expect(filterNodes(nodes, '')).toHaveLength(4)
  })

  it('includes Alpha Merge alongside nodes from stage metadata', async () => {
    const stage = { node_id: 'ComfyTV.ImageStage', kind: 'image' }
    const load = vi.spyOn(stageMeta, 'loadStageMeta').mockResolvedValue(new Map([[stage.node_id, stage]]))
    vi.stubGlobal('LiteGraph', {
      registered_node_types: {
        'ComfyTV.AlphaMerge': { category: 'ComfyTV/Image' },
        'ComfyTV.ImageStage': { category: 'ComfyTV/Generate' },
        'ComfyTV.ProjectStage': { category: 'ComfyTV/Project' },
        LoadImage: { category: 'image' },
      },
    })
    try {
      const nodes = await listComfyTVNodes()
      expect(nodes.map(node => node.classType).sort()).toEqual(['ComfyTV.AlphaMerge', 'ComfyTV.ImageStage'])
      expect(filterNodes(nodes, 'alpha', 'image')).toEqual([
        expect.objectContaining({ classType: 'ComfyTV.AlphaMerge', category: 'image' }),
      ])
    } finally {
      load.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('derives folder badges from native workflow paths', () => {
    expect(nativeWorkflowFolder('demo.json')).toBe('')
    expect(nativeWorkflowFolder('team/demo.json')).toBe('team')
    expect(nativeWorkflowFolder('ads/campaign/a.json')).toBe('ads/campaign')
  })

  it('maps menu paths and groups by category', () => {
    expect(categoryFromMenuPath('ComfyTV/Generate')).toBe('generate')
    expect(categoryFromMenuPath('ComfyTV/VideoFX')).toBe('video')
    expect(inferSearchCategory('ComfyTV.ImagesSplitStage', 'image', 'transform')).toBe('edit')
    const nodes = [
      { classType: 'ComfyTV.A', label: 'B', category: 'video' as const },
      { classType: 'ComfyTV.B', label: 'A', category: 'video' as const },
      { classType: 'ComfyTV.C', label: 'C', category: 'image' as const },
    ]
    const groups = groupNodesByCategory(nodes)
    expect(groups.map((g) => g.id)).toEqual(['image', 'video'])
    expect(groups[1].nodes.map((n) => n.label)).toEqual(['A', 'B'])
  })

  it('copies a template and opens only its local path', async () => {
    const row = {
      path: 'templates/a.json', name: 'a', mtime: 1, size: 2,
      is_linked: false, linked_id: null,
    }
    const graph = { id: 'new', nodes: [] }
    const instantiate = vi.fn(async () => ({ path: '_local/a.json', graph }))
    const open = vi.fn(async () => true)

    await expect(openWorkflowTemplateRow(row, { instantiate, open })).resolves.toBe(true)
    expect(instantiate).toHaveBeenCalledWith('templates/a.json')
    expect(open).toHaveBeenCalledWith('_local/a.json', graph)
  })
})
