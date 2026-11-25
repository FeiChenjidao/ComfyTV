import { screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithPlugins } from '@/__tests__/renderHelpers'
import BottomBar from './BottomBar.vue'

const mocks = vi.hoisted(() => ({
  fetchNativeWorkflowGitStatus: vi.fn(),
  saveGitExecutable: vi.fn(),
  setupNativeWorkflowGit: vi.fn(),
  fetchNativeWorkflowGitToken: vi.fn(),
}))

vi.mock('@/api', () => ({
  fetchNativeWorkflowGitStatus: mocks.fetchNativeWorkflowGitStatus,
  saveGitExecutable: mocks.saveGitExecutable,
  fetchNativeWorkflowGitToken: mocks.fetchNativeWorkflowGitToken,
  pullNativeWorkflowGit: vi.fn(),
  pushNativeWorkflowGit: vi.fn(),
  saveNativeWorkflowGitToken: vi.fn(),
  setupNativeWorkflowGit: mocks.setupNativeWorkflowGit,
}))

vi.mock('./AssetsPopup.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./WorkflowLibrary.vue', () => ({ default: { template: '<div />' } }))
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

describe('team repository connection status', () => {
  const disconnected = { ok: true, has_git: true, is_repo: false, token_configured: true, files: [] }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchNativeWorkflowGitToken.mockResolvedValue({ ok: true, configured: true })
    mocks.fetchNativeWorkflowGitStatus.mockResolvedValue(disconnected)
  })

  it('preserves the actual clone failure instead of overwriting it with not connected', async () => {
    mocks.setupNativeWorkflowGit.mockResolvedValue({
      ...disconnected, ok: false, error: 'Could not resolve host: github.com',
    })
    renderWithPlugins(BottomBar)
    await userEvent.click(screen.getByRole('button', { name: 'Workflows' }))
    expect(await screen.findByText('Could not resolve host: github.com')).toBeInTheDocument()
    expect(mocks.fetchNativeWorkflowGitStatus).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Connect team repo' })).toBeEnabled()
  })

  it('keeps setup request errors visible and allows retry', async () => {
    mocks.setupNativeWorkflowGit.mockRejectedValue(new Error('Setup request timed out'))
    renderWithPlugins(BottomBar)
    await userEvent.click(screen.getByRole('button', { name: 'Workflows' }))
    expect(await screen.findByText('Setup request timed out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect team repo' })).toBeEnabled()
    expect(mocks.fetchNativeWorkflowGitStatus).toHaveBeenCalledTimes(1)
  })

  it('shows remote fetch failures instead of claiming the repository is synced', async () => {
    mocks.fetchNativeWorkflowGitStatus.mockResolvedValue({
      ...disconnected, is_repo: true, ahead: 0, behind: 0, dirty: false,
      fetch_error: 'Failed to connect to github.com',
    })
    renderWithPlugins(BottomBar)
    await userEvent.click(screen.getByRole('button', { name: 'Workflows' }))
    expect(await screen.findByText('Failed to connect to github.com')).toBeInTheDocument()
    expect(mocks.setupNativeWorkflowGit).not.toHaveBeenCalled()
  })

  it('refreshes remote status after a successful first clone', async () => {
    const connected = { ...disconnected, is_repo: true, ahead: 0, behind: 0, dirty: false }
    mocks.setupNativeWorkflowGit.mockResolvedValue(connected)
    mocks.fetchNativeWorkflowGitStatus.mockResolvedValueOnce(disconnected).mockResolvedValue(connected)
    renderWithPlugins(BottomBar)
    await userEvent.click(screen.getByRole('button', { name: 'Workflows' }))
    await waitFor(() => expect(mocks.fetchNativeWorkflowGitStatus).toHaveBeenLastCalledWith(true))
    expect(screen.getByRole('button', { name: 'Update templates' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Connect team repo' })).not.toBeInTheDocument()
  })
})
