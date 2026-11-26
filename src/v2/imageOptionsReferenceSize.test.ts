import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeI18n } from '@/__tests__/renderHelpers'
import GptImageOptionsV2 from '@/v2/GptImageOptionsV2.vue'
import SeedreamOptionsV2 from '@/v2/SeedreamOptionsV2.vue'

const mocks = vi.hoisted(() => ({
  entries: [] as Array<{ url: string }>,
  loadMediaInfo: vi.fn(),
}))
vi.mock('@/composables/stages/mediaOrder', () => ({
  currentMediaTable: () => ({ image: mocks.entries }),
}))
vi.mock('@/composables/stages/mediaOrderSync', () => ({
  mediaEntryUrl: (_node: unknown, entry: { url: string }) => entry.url,
}))
vi.mock('@/composables/stages/useMediaInfo', () => ({ loadMediaInfo: mocks.loadMediaInfo }))
vi.mock('@/lib/comfyApp', () => ({ app: { api: { fetchApi: async () => ({ ok: false }) } } }))

const mounted: Array<{ unmount: () => void }> = []
function setup(component: typeof GptImageOptionsV2 | typeof SeedreamOptionsV2, items: Array<{ key: string; value: unknown }> = []) {
  const params = { name: 'custom_params', value: JSON.stringify({ items }), callback: vi.fn() }
  const node: any = {
    widgets: [params, { name: 'batch_size', value: 1 }, { name: 'workflow', value: 'current' }],
    graph: { change: vi.fn() },
  }
  const wrapper = mount(component, {
    props: { getNode: () => node },
    global: {
      plugins: [makeI18n()],
      stubs: { ComfyTVPopover: { template: '<div><slot name="trigger" /><slot /></div>' }, ComfyTVSelect: true },
    },
  })
  mounted.push(wrapper)
  const values = () => Object.fromEntries(JSON.parse(params.value).items.map((item: any) => [item.key, item.value]))
  return { wrapper, node, params, values }
}

beforeEach(() => {
  mocks.entries = [{ url: '/view?filename=first.png' }, { url: '/view?filename=second.png' }]
  mocks.loadMediaInfo.mockReset().mockResolvedValue({ kind: 'image', width: 1536, height: 1024 })
})
afterEach(() => { for (const wrapper of mounted.splice(0)) wrapper.unmount() })

describe('image options reference size button', () => {
  it('copies image 1 into GPT custom dimensions together and keeps existing parameter keys', async () => {
    const { wrapper, params, values } = setup(GptImageOptionsV2, [
      { key: 'model.size', value: 'auto' },
      { key: 'model.custom_width', value: 1024 },
      { key: 'quality', value: 'high' },
    ])
    await wrapper.find('.v2-refsize button').trigger('click')
    await flushPromises()
    expect(mocks.loadMediaInfo).toHaveBeenCalledExactlyOnceWith('/view?filename=first.png')
    expect(values()).toEqual({ 'model.size': 'Custom', 'model.custom_width': 1536, custom_height: 1024, quality: 'high' })
    expect(params.callback).toHaveBeenCalledTimes(1)
    await wrapper.find('input[type="range"]').setValue('1920')
    expect(values().custom_height).toBe(1280)
  })

  it('switches Seedream to Custom and respects its size step', async () => {
    mocks.loadMediaInfo.mockResolvedValue({ kind: 'image', width: 1535, height: 1023 })
    const { wrapper, values } = setup(SeedreamOptionsV2, [{ key: 'model', value: 'seedream 5.5' }])
    await wrapper.find('.v2-refsize button').trigger('click')
    await flushPromises()
    expect(values()).toEqual({ model: 'seedream 5.5', size_preset: 'Custom', width: 1536, height: 1024 })
  })

  it('uses the current first reference after reordering and snaps GPT dimensions to 16', async () => {
    const { wrapper, values } = setup(GptImageOptionsV2)
    mocks.entries.reverse()
    mocks.loadMediaInfo.mockResolvedValue({ kind: 'image', width: 1401, height: 1001 })
    await wrapper.find('.v2-refsize button').trigger('click')
    await flushPromises()
    expect(mocks.loadMediaInfo).toHaveBeenCalledWith('/view?filename=second.png')
    expect(values()).toEqual({ size: 'Custom', custom_width: 1408, custom_height: 1008 })
  })

  it('leaves dimensions unchanged when image 1 is absent or unreadable', async () => {
    const { wrapper, params } = setup(GptImageOptionsV2)
    mocks.entries = []
    await wrapper.find('.v2-refsize button').trigger('click')
    expect(wrapper.find('[role="status"]').text()).toContain('请先添加参考图1')
    expect(mocks.loadMediaInfo).not.toHaveBeenCalled()
    mocks.entries = [{ url: '/view?filename=missing.png' }]
    mocks.loadMediaInfo.mockResolvedValue(null)
    await wrapper.find('.v2-refsize button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toContain('无法读取图1尺寸')
    expect(params.callback).not.toHaveBeenCalled()
  })

  it('discards a pending result when the workflow changes', async () => {
    let finish!: (value: unknown) => void
    mocks.loadMediaInfo.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { wrapper, node, params } = setup(SeedreamOptionsV2)
    await wrapper.find('.v2-refsize button').trigger('click')
    expect(wrapper.find('.v2-refsize button').attributes('disabled')).toBeDefined()
    node.widgets[2].value = 'another workflow'
    finish({ kind: 'image', width: 1536, height: 1024 })
    await flushPromises()
    expect(params.callback).not.toHaveBeenCalled()
  })
})
