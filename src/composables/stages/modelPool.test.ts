import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  mergeModelOutputIntoPool,
  pickModelPoolIndex,
} from '@/composables/stages/modelPool'
import {
  imagePoolCount,
  toImagePoolJson,
  useStageStore,
  type StageState,
} from '@/stores/stageStore'

function modelState(partial: Partial<StageState> = {}): StageState {
  return {
    kind: 'model',
    variant: 'generator',
    outputType: 'COMFYTV_MODEL',
    output: null,
    outputs: [null],
    running: false,
    inputs: [],
    mainPrompt: '',
    pickedIndex: 1,
    pool: null,
    ...partial,
  }
}

function nodeWithPool(append = true) {
  return {
    widgets: [
      { name: 'pool', value: '' },
      { name: 'selected_index', value: 1 },
      { name: 'append_results', value: append },
    ],
  }
}

function urls(pool: string | null | undefined): string[] {
  try {
    return (JSON.parse(String(pool ?? '')).images as Array<{ image_url: string }>)
      .map(i => i.image_url)
  } catch {
    return []
  }
}

describe('mergeModelOutputIntoPool', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('appends a new model URL and selects index 1', () => {
    const store = useStageStore()
    const node = nodeWithPool(true)
    const state = modelState({ pool: toImagePoolJson('/view?filename=old.glb') })
    mergeModelOutputIntoPool(node, state, store, '/view?filename=new.glb')
    expect(urls(state.pool)).toEqual(['/view?filename=new.glb', '/view?filename=old.glb'])
    expect(state.pickedIndex).toBe(1)
    expect(node.widgets.find(w => w.name === 'selected_index')!.value).toBe(1)
    expect(imagePoolCount(state.pool)).toBe(2)
  })

  it('replace mode keeps only the newest URL', () => {
    const store = useStageStore()
    const node = nodeWithPool(false)
    const state = modelState({ pool: toImagePoolJson('/view?filename=old.glb') })
    mergeModelOutputIntoPool(node, state, store, '/view?filename=new.glb')
    expect(urls(state.pool)).toEqual(['/view?filename=new.glb'])
    expect(state.pickedIndex).toBe(1)
  })

  it('dedupes an identical URL without resetting selection when already present', () => {
    const store = useStageStore()
    const node = nodeWithPool(true)
    const existing = toImagePoolJson('/view?filename=a.glb')
    const state = modelState({ pool: existing, pickedIndex: 1 })
    // Pre-seed as if newer was already on top after a prior merge with a second item
    store.setPickerPool(node, state, JSON.stringify({
      images: [
        { index: '1', image_url: '/view?filename=a.glb' },
        { index: '2', image_url: '/view?filename=b.glb' },
      ],
    }))
    state.pickedIndex = 2
    node.widgets.find(w => w.name === 'selected_index')!.value = 2
    mergeModelOutputIntoPool(node, state, store, '/view?filename=a.glb')
    expect(urls(state.pool)).toEqual(['/view?filename=a.glb', '/view?filename=b.glb'])
    // No new item added → keep current pick
    expect(state.pickedIndex).toBe(2)
  })

  it('ignores non-model stages and empty URLs', () => {
    const store = useStageStore()
    const node = nodeWithPool(true)
    const image = modelState({ kind: 'image' as any, pool: null })
    mergeModelOutputIntoPool(node, image, store, '/view?filename=x.glb')
    expect(image.pool).toBeNull()
    const empty = modelState()
    mergeModelOutputIntoPool(node, empty, store, '  ')
    expect(empty.pool).toBeNull()
  })
})

describe('pickModelPoolIndex', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('publishes the selected pool URL as the live output', () => {
    const store = useStageStore()
    const node = nodeWithPool(true)
    const state = modelState({
      pool: JSON.stringify({
        images: [
          { index: '1', image_url: '/view?filename=a.glb' },
          { index: '2', image_url: '/view?filename=b.glb' },
        ],
      }),
      output: '/view?filename=a.glb',
      outputs: ['/view?filename=a.glb'],
    })
    pickModelPoolIndex(node, state, store, 2)
    expect(state.pickedIndex).toBe(2)
    expect(state.output).toBe('/view?filename=b.glb')
    expect(state.outputs[0]).toBe('/view?filename=b.glb')
    expect(node.widgets.find(w => w.name === 'selected_index')!.value).toBe(2)
  })

  it('clamps out-of-range indices', () => {
    const store = useStageStore()
    const node = nodeWithPool(true)
    const state = modelState({
      pool: toImagePoolJson('/view?filename=only.glb'),
    })
    pickModelPoolIndex(node, state, store, 99)
    expect(state.pickedIndex).toBe(1)
    expect(state.output).toBe('/view?filename=only.glb')
  })
})
