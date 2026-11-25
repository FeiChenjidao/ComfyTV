import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeI18n } from '@/__tests__/renderHelpers'
import { app } from '@/lib/comfyApp'
import { workflowAutoSave as state } from '@/composables/workflowAutoSave'
import WorkflowAutoSaveSettings from './WorkflowAutoSaveSettings.vue'

beforeEach(() => {
  vi.mocked(app.api.fetchApi).mockReset().mockResolvedValue(Response.json('saved'))
  Object.assign(state, { enabled: false, intervalSeconds: 300, loaded: true, saving: false, configuring: false,
    waiting: false, nextSaveAt: null, lastSavedAt: null, lastSavedCount: 0, result: null, error: '' })
})
function render() {
  return mount(WorkflowAutoSaveSettings, { global: { plugins: [makeI18n()] } })
}

describe('workflow auto-save settings', () => {
  it('applies a custom interval and shows the next-save countdown', async () => {
    const wrapper = render()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('input[type="number"]').setValue(75)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(state.enabled).toBe(true)
    expect(state.intervalSeconds).toBe(75)
    expect(wrapper.get('[role="status"]').text()).toBe('Next save: 1:15')
    expect(JSON.parse(String(vi.mocked(app.api.fetchApi).mock.calls[0][1]?.body)))
      .toEqual({ enabled: true, intervalSeconds: 75 })
    wrapper.unmount()
  })

  it('keeps the active configuration when an invalid interval is entered', async () => {
    const wrapper = render()
    await wrapper.get('input[type="number"]').setValue(0)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('10 to 86400')
    expect(app.api.fetchApi).not.toHaveBeenCalled()
    expect(state.intervalSeconds).toBe(300)
    wrapper.unmount()
  })

  it('shows local save errors and filters against the sidebar search', async () => {
    const wrapper = render()
    state.result = { saved: 0, skipped: 0, failures: [{ path: 'workflows/a.json', error: 'Disk full' }] }
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Disk full')
    await wrapper.setProps({ query: 'Ctrl+S' })
    expect(wrapper.find('section').exists()).toBe(true)
    await wrapper.setProps({ query: 'unrelated-section' })
    expect(wrapper.find('section').exists()).toBe(false)
    wrapper.unmount()
  })
})
