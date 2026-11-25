import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeI18n } from '@/__tests__/renderHelpers'
import type { NativeWorkflow } from '@/api'
import { app } from '@/lib/comfyApp'
import WorkflowLibrary from './WorkflowLibrary.vue'
import { GROUPS_FILE, groupWorkflowRows, initialWorkflowGroups, type WorkflowGroups } from './workflowGroups'

function row(name: string, path = `${name}.json`): NativeWorkflow {
  return { name, path, mtime: 1, size: 1, is_linked: false }
}
let stored: WorkflowGroups | null
let failSave: boolean
const fetchApi = vi.mocked(app.api.fetchApi)

beforeEach(() => {
  stored = null
  failSave = false
  fetchApi.mockReset()
  fetchApi.mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') {
      if (failSave) return new Response('', { status: 500 })
      stored = JSON.parse(String(options.body))
      return Response.json(GROUPS_FILE)
    }
    return stored ? Response.json(stored) : new Response('', { status: 404 })
  })
})

async function render(templates = [row('原画To3D'), row('刺绣'), row('Unknown')], local: NativeWorkflow[] = []) {
  const wrapper = mount(WorkflowLibrary, {
    props: { templates, local, openingPath: null, badges: new Map() },
    global: { plugins: [makeI18n()] },
  })
  await flushPromises()
  return wrapper
}
async function manage(wrapper: Awaited<ReturnType<typeof render>>) {
  await wrapper.get('button[aria-pressed]').trigger('click')
}

describe('workflow grouping', () => {
  it('organizes all nine existing templates and keeps the template and local scopes separate', () => {
    const names = ['测试专用工作流', '场景物件基础拆解', '刺绣', '灯光工作流', '高清毛发工作流', '三视图转模型', '衣褶优化工作流', '原画To3D', 'PS_NanoBanana_GPTImage']
    const rows = names.map(name => row(name))
    const data = initialWorkflowGroups({ templates: rows, local: [] }, id => id)
    const grouped = groupWorkflowRows(rows, data.templates)
    expect(grouped.find(group => group.id === 'character')?.rows.map(row => row.name))
      .toEqual(['刺绣', '高清毛发工作流', '三视图转模型', '衣褶优化工作流', '原画To3D'])
    expect(grouped.find(group => group.id === 'scene')?.rows.map(row => row.name)).toEqual(['场景物件基础拆解'])
    expect(grouped.find(group => group.id === 'general')?.rows).toHaveLength(2)
    expect(grouped.find(group => group.id === '')?.rows).toHaveLength(0)
    expect(Object.keys(data.templates.assignments)).toHaveLength(9)
    expect(data.local.assignments).toEqual({})
  })

  it('saves defaults in the account userdata and preserves template opening behavior', async () => {
    const template = row('原画To3D')
    const wrapper = await render([template])
    expect(fetchApi).toHaveBeenCalledWith(`/userdata/${encodeURIComponent(GROUPS_FILE)}`)
    expect(stored?.templates.assignments[template.path]).toBe('character')
    await wrapper.get('.workflow-library__row').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual([template, true])
    await wrapper.get('.workflow-library__toggle').trigger('click')
    expect(wrapper.find('.workflow-library__row').exists()).toBe(false)
    wrapper.unmount()
  })

  it('creates, renames and moves groups and restores the choices after reopening', async () => {
    const wrapper = await render()
    await manage(wrapper)
    await wrapper.get('input[aria-label="Templates: Group name"]').setValue('Favorites')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const favorites = stored!.templates.groups.find(group => group.name === 'Favorites')!
    await wrapper.get('select[aria-label="Move to group: 原画To3D"]').setValue(favorites.id)
    await flushPromises()
    await wrapper.get('input[aria-label="Rename: Favorites"]').setValue('My favorites')
    await flushPromises()
    expect(stored!.templates.assignments['原画To3D.json']).toBe(favorites.id)
    expect(stored!.templates.groups.find(group => group.id === favorites.id)?.name).toBe('My favorites')
    wrapper.unmount()
    const reopened = await render()
    expect(reopened.text()).toContain('My favorites')
    const group = reopened.findAll('.workflow-library__group').find(group => group.text().includes('My favorites'))!
    expect(group.text()).toContain('原画To3D')
    reopened.unmount()
  })

  it('moves workflows to Ungrouped on deletion without affecting the other library', async () => {
    const source = row('原画To3D')
    const wrapper = await render([source], [source])
    await manage(wrapper)
    await wrapper.findAll('button[aria-label="Delete group: Character"]')[0].trigger('click')
    await flushPromises()
    expect(stored!.templates.assignments[source.path]).toBeUndefined()
    expect(stored!.local.assignments[source.path]).toBe('character')
    const ungrouped = wrapper.findAll('.workflow-library__group').find(group => group.text().includes('Ungrouped'))!
    expect(ungrouped.text()).toContain(source.name)
    wrapper.unmount()
  })

  it('groups templates that arrive after sync but remembers an explicit move to Ungrouped', async () => {
    const source = row('原画To3D')
    const wrapper = await render([])
    await wrapper.setProps({ templates: [source] })
    await manage(wrapper)
    const select = wrapper.get('select[aria-label="Move to group: 原画To3D"]')
    expect((select.element as HTMLSelectElement).value).toBe('character')
    await select.setValue('')
    await flushPromises()
    wrapper.unmount()
    const reopened = await render([source])
    const group = reopened.findAll('.workflow-library__group').find(group => group.text().includes('Ungrouped'))!
    expect(group.text()).toContain(source.name)
    reopened.unmount()
  })

  it('keeps failed saves available for retry and rejects duplicate group names', async () => {
    const wrapper = await render()
    await manage(wrapper)
    await wrapper.get('input[aria-label="Templates: Group name"]').setValue('Character')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('already exists')
    await wrapper.get('input[aria-label="Templates: Group name"]').setValue('Favorites')
    failSave = true
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save')
    failSave = false
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(stored!.templates.groups.some(group => group.name === 'Favorites')).toBe(true)
    wrapper.unmount()
  })

  it('does not overwrite invalid or unreadable stored preferences', async () => {
    fetchApi.mockResolvedValue(Response.json({ unexpected: true }))
    const wrapper = await render()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    expect(wrapper.findAll('.workflow-library__row')).toHaveLength(3)
    expect(wrapper.get('button[aria-pressed]').attributes('disabled')).toBeDefined()
    expect(fetchApi.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
    wrapper.unmount()
  })
})
