import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/comfyApp', () => ({ app: {} }))

import { applyPhotoshopLayer, IMAGE_LOADER_CLASS } from './photoshopBridge'

const payload = {
  name: 'ps-layer.png',
  subfolder: 'comfytv/photoshop',
  type: 'input' as const,
  url: '/view?filename=ps-layer.png&subfolder=comfytv/photoshop&type=input',
  document: 'Concept.psd',
  layer: 'Character',
  width: 800,
  height: 600,
}

function loader(): any {
  const callback = vi.fn()
  return {
    comfyClass: IMAGE_LOADER_CLASS,
    properties: {},
    size: [280, 340],
    widgets: [{ name: 'image', value: '', callback, options: { values: [] } }],
    callback,
  }
}

describe('applyPhotoshopLayer', () => {
  beforeEach(() => {
    vi.stubGlobal('LiteGraph', { createNode: vi.fn(() => loader()) })
  })

  it('updates the selected image loader', () => {
    const node = loader()
    const host = {
      canvas: { selected_nodes: { 1: node }, selectNode: vi.fn(), centerOnNode: vi.fn() },
      graph: { _nodes: [node], setDirtyCanvas: vi.fn() },
    }
    expect(applyPhotoshopLayer(host, payload)).toBe(node)
    expect(node.widgets[0]!.value).toBe('comfytv/photoshop/ps-layer.png')
    expect(node.callback).toHaveBeenCalled()
    expect(node.title).toBe('Photoshop: Character')
    expect(host.canvas.selectNode).toHaveBeenCalledWith(node)
  })

  it('creates a loader when the graph has no target', () => {
    const added: any[] = []
    const host = {
      canvas: { selected_nodes: {}, graph_mouse: [120, 80], selectNode: vi.fn(), centerOnNode: vi.fn() },
      graph: { _nodes: [], add: (node: any) => added.push(node), setDirtyCanvas: vi.fn() },
    }
    const node = applyPhotoshopLayer(host, payload)
    expect(node).toBe(added[0])
    expect(node.pos).toEqual([120, 80])
    expect(node.widgets[0].value).toBe('comfytv/photoshop/ps-layer.png')
    expect(host.canvas.selectNode).not.toHaveBeenCalled()
  })

  it('creates a new loader for every send when no loader is selected', () => {
    const added: any[] = []
    const host = {
      canvas: { selected_nodes: {}, graph_mouse: [120, 80], selectNode: vi.fn(), centerOnNode: vi.fn() },
      graph: {
        _nodes: added,
        add: (node: any) => added.push(node),
        setDirtyCanvas: vi.fn(),
      },
    }
    const first = applyPhotoshopLayer(host, payload)
    const second = applyPhotoshopLayer(host, { ...payload, name: 'ps-layer-2.png' })
    expect(added).toHaveLength(2)
    expect(first).not.toBe(second)
    expect(first.widgets[0].value).toBe('comfytv/photoshop/ps-layer.png')
    expect(second.widgets[0].value).toBe('comfytv/photoshop/ps-layer-2.png')
  })

  it('creates a loader when multiple nodes are selected', () => {
    const selectedLoader = loader()
    const added: any[] = []
    const host = {
      canvas: {
        selected_nodes: { 1: selectedLoader, 2: { comfyClass: 'KSampler' } },
        selectNode: vi.fn(),
        centerOnNode: vi.fn(),
      },
      graph: { _nodes: [selectedLoader], add: (node: any) => added.push(node), setDirtyCanvas: vi.fn() },
    }
    const node = applyPhotoshopLayer(host, payload)
    expect(node).not.toBe(selectedLoader)
    expect(node).toBe(added[0])
  })

  it('creates a new loader when create_new is set, even if one loader is selected', () => {
    const selectedLoader = loader()
    const added: any[] = []
    const host = {
      canvas: { selected_nodes: { 1: selectedLoader }, selectNode: vi.fn(), centerOnNode: vi.fn() },
      graph: { _nodes: [selectedLoader], add: (node: any) => added.push(node), setDirtyCanvas: vi.fn() },
    }
    const node = applyPhotoshopLayer(host, { ...payload, name: 'ps-layer-2.png', create_new: true })
    expect(node).not.toBe(selectedLoader)
    expect(node).toBe(added[0])
    expect(selectedLoader.widgets[0].value).toBe('')
    expect(node.widgets[0].value).toBe('comfytv/photoshop/ps-layer-2.png')
  })
})
