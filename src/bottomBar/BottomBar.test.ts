import { screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithPlugins } from '@/__tests__/renderHelpers'
import BottomBar from './BottomBar.vue'

const mocks = vi.hoisted(() => ({
  fetchNativeWorkflowGitStatus: vi.fn(),
  saveGitExecutable: vi.fn(),
}))

vi.mock('@/api', () => ({
  fetchNativeWorkflowGitStatus: mocks.fetchNativeWorkflowGitStatus,
  saveGitExecutable: mocks.saveGitExecutable,
  fetchNativeWorkflowGitToken: vi.fn(),
  pullNativeWorkflowGit: vi.fn(),
  pushNativeWorkflowGit: vi.fn(),
  saveNativeWorkflowGitToken: vi.fn(),
  setupNativeWorkflowGit: vi.fn(),
}))

vi.mock('./AssetsPopup.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./actions', () => ({
  QUICK_CREATE: [], SEARCH_CATEGORY_IDS: [],
  filterNodes: () => [], groupNodesByCategory: () => [],
  listBottomBarTemplates: async () => [], listBottomBarWorkflows: async () => [],
  listComfyTVNodes: async () => [], nativeWorkflowFolder: () => '',
  openWorkflowRow: vi.fn(), openWorkflowTemplateRow: vi.fn(), spawnStageAtCenter: vi.fn(),
}))

async function openGitPath() {
  renderWithPlugins(BottomBar)
  await userEvent.click(screen.getByRole('button', { name: 'Workflows' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Set Git path' }))
  return screen.getByLabelText('Set Git path')
}

describe('manual Git path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchNativeWorkflowGitStatus.mockResolvedValue({ has_git: false, is_repo: false })
  })

  it('keeps the form open with the error so a failed path can be corrected', async () => {
    mocks.saveGitExecutable.mockResolvedValue({ ok: false, error: 'Git executable not found at this path.' })
    const input = await openGitPath()
    const submit = screen.getByRole('button', { name: 'Verify and add to PATH' })
    expect(submit).toBeDisabled()
    await userEvent.type(input, 'C:\\missing\\git.exe')
    await userEvent.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('Git executable not found at this path.')
    expect(input).toHaveValue('C:\\missing\\git.exe')
    expect(submit).toBeEnabled()
  })

  it('refreshes Git status after saving without requiring a backend restart', async () => {
    const input = await openGitPath()
    mocks.saveGitExecutable.mockResolvedValue({ ok: true, version: 'git version 2.47.0', path: 'C:\\Git\\cmd\\git.exe' })
    mocks.fetchNativeWorkflowGitStatus.mockResolvedValue({ has_git: true, is_repo: true, behind: 0, files: [] })
    await userEvent.type(input, 'C:\\Git\\cmd\\git.exe')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and add to PATH' }))
    await waitFor(() => expect(screen.queryByLabelText('Set Git path')).not.toBeInTheDocument())
    expect(mocks.saveGitExecutable).toHaveBeenCalledWith('C:\\Git\\cmd\\git.exe')
    expect(mocks.fetchNativeWorkflowGitStatus).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'Update templates' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Set Git path' })).not.toBeInTheDocument()
  })
})
