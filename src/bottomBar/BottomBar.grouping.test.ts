import { screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithPlugins } from '@/__tests__/renderHelpers'
import { app } from '@/lib/comfyApp'
import type { WorkflowGroups } from './workflowGroups'
import BottomBar from './BottomBar.vue'

const mocks = vi.hoisted(() => ({ push: vi.fn(), templates: vi.fn(), locals: vi.fn() }))
const connected = { ok: true, has_git: true, is_repo: true, ahead: 0, behind: 0, dirty: false, files: [] }

vi.mock('@/api', () => ({
  fetchNativeWorkflowGitStatus: async () => ({ ok: true, has_git: true, is_repo: true, ahead: 0, behind: 0, dirty: false, files: [] }),
  fetchNativeWorkflowGitToken: async () => ({ ok: true, configured: true }),
  pushNativeWorkflowGit: mocks.push,
  pullNativeWorkflowGit: vi.fn(), saveNativeWorkflowGitToken: vi.fn(),
  saveGitExecutable: vi.fn(), setupNativeWorkflowGit: vi.fn(),
}))
vi.mock('./AssetsPopup.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./actions', () => ({
  QUICK_CREATE: [], SEARCH_CATEGORY_IDS: [], filterNodes: () => [], groupNodesByCategory: () => [],
  listBottomBarTemplates: mocks.templates, listBottomBarWorkflows: mocks.locals,
  listComfyTVNodes: async () => [], nativeWorkflowFolder: () => '',
  openWorkflowRow: vi.fn(), openWorkflowTemplateRow: vi.fn(), spawnStageAtCenter: vi.fn(),
}))

let stored: WorkflowGroups | null
let rejectGrouping: boolean
const workflow = { name: 'My workflow', path: 'local/My workflow.json', mtime: 1, size: 1, is_linked: false }

beforeEach(() => {
  vi.clearAllMocks()
  stored = null
  rejectGrouping = false
  mocks.templates.mockResolvedValue([])
  mocks.locals.mockResolvedValue([workflow])
  mocks.push.mockResolvedValue({ ...connected, paths: ['My workflow.json'], pushed: true })
  vi.mocked(app.api.fetchApi).mockImplementation(async (_url, options) => {
    if (options?.method === 'POST') {
      const next = JSON.parse(String(options.body)) as WorkflowGroups
      if (rejectGrouping && Object.hasOwn(next.templates.assignments, 'My workflow.json')) {
        return new Response('', { status: 500 })
      }
      stored = next
      return Response.json('comfytv/workflow-groups.json')
    }
    return stored ? Response.json(stored) : new Response('', { status: 404 })
  })
})

async function openPicker() {
  renderWithPlugins(BottomBar)
  await userEvent.click(screen.getByRole('button', { name: 'Workflows' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Commit workflows' }))
  const select = await screen.findByLabelText('Submit to group')
  await waitFor(() => expect(select).toBeEnabled())
  await userEvent.click(screen.getByRole('checkbox'))
  return select
}

describe('group selection during workflow submission', () => {
  it('assigns the published template path to the chosen existing group', async () => {
    const select = await openPicker()
    await userEvent.selectOptions(select, 'scene')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm commit' }))
    await waitFor(() => expect(stored?.templates.assignments['My workflow.json']).toBe('scene'))
    expect(stored?.templates.assignments[workflow.path]).toBeUndefined()
    expect(mocks.push).toHaveBeenCalledWith([workflow.path], '')
  })

  it('lets a submitter create an arbitrary group and select it immediately', async () => {
    const select = await openPicker()
    await userEvent.click(screen.getByRole('button', { name: 'New group', exact: true }))
    await userEvent.type(screen.getByLabelText('Group name'), 'Marketing campaign')
    await userEvent.click(screen.getByRole('button', { name: 'Create and select' }))
    const custom = stored!.templates.groups.find(group => group.name === 'Marketing campaign')!
    expect(custom).toBeDefined()
    await waitFor(() => expect(select).toHaveValue(custom.id))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm commit' }))
    await waitFor(() => expect(stored!.templates.assignments['My workflow.json']).toBe(custom.id))
  })

  it('does not change assignments if workflow submission fails', async () => {
    mocks.push.mockResolvedValue({ ...connected, ok: false, error: 'Push failed' })
    const select = await openPicker()
    await userEvent.selectOptions(select, 'scene')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm commit' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce())
    expect(stored!.templates.assignments).toEqual({})
    expect(screen.getByLabelText('Submit to group')).toBeInTheDocument()
  })

  it('retries group persistence without pushing a submitted workflow again', async () => {
    const select = await openPicker()
    await userEvent.selectOptions(select, 'scene')
    rejectGrouping = true
    await userEvent.click(screen.getByRole('button', { name: 'Confirm commit' }))
    const retry = await screen.findByRole('button', { name: 'Retry saving group' })
    expect(screen.getByRole('alert')).toHaveTextContent('Workflows submitted')
    rejectGrouping = false
    await userEvent.click(retry)
    await waitFor(() => expect(stored!.templates.assignments['My workflow.json']).toBe('scene'))
    expect(mocks.push).toHaveBeenCalledOnce()
  })

  it('rejects duplicate new group names without losing the submission selection', async () => {
    const select = await openPicker()
    await userEvent.click(screen.getByRole('button', { name: 'New group', exact: true }))
    await userEvent.type(screen.getByLabelText('Group name'), 'Character')
    await userEvent.click(screen.getByRole('button', { name: 'Create and select' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Group name already exists')
    expect(select).toHaveValue('__keep__')
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
