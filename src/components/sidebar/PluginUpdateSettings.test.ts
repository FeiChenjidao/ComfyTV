import { screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithPlugins } from '@/__tests__/renderHelpers'
import type { PluginUpdateStatus } from '@/api'

import PluginUpdateSettings from './PluginUpdateSettings.vue'

const mocks = vi.hoisted(() => ({
  fetchPluginUpdateStatus: vi.fn(),
  rollbackPluginUpdate: vi.fn(),
  presentPluginUpdate: vi.fn(),
  presentPluginRestart: vi.fn(),
  askConfirm: vi.fn(),
}))

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  fetchPluginUpdateStatus: mocks.fetchPluginUpdateStatus,
  rollbackPluginUpdate: mocks.rollbackPluginUpdate,
}))

vi.mock('@/composables/pluginUpdateCheck', () => ({
  presentPluginUpdate: mocks.presentPluginUpdate,
  presentPluginRestart: mocks.presentPluginRestart,
}))

vi.mock('@/composables/dialog/useConfirmDialog', () => ({
  askConfirm: mocks.askConfirm,
}))

function updateStatus(overrides: Partial<PluginUpdateStatus> = {}): PluginUpdateStatus {
  return {
    ok: true,
    is_repo: true,
    has_git: true,
    update_available: false,
    local_version: '1.10.0',
    remote_version: '1.10.0',
    local_sha: '1111111111111111',
    remote_sha: '1111111111111111',
    behind: 0,
    ahead: 0,
    dirty: false,
    repair_available: false,
    branch: 'main',
    remote: 'origin',
    remote_url: 'https://github.com/example/ComfyTV.git',
    restart_required: false,
    update_in_progress: false,
    rollback_available: false,
    rollback_sha: '',
    rollback_version: '',
    backup_path: '',
    local_backups: [],
    dependency_files_changed: [],
    rolled_back: false,
    error: '',
    error_code: '',
    ...overrides,
  }
}

describe('PluginUpdateSettings', () => {
  beforeEach(() => {
    mocks.fetchPluginUpdateStatus.mockReset()
    mocks.rollbackPluginUpdate.mockReset()
    mocks.presentPluginUpdate.mockReset()
    mocks.presentPluginRestart.mockReset()
    mocks.askConfirm.mockReset()
    mocks.presentPluginUpdate.mockResolvedValue('later')
    mocks.askConfirm.mockResolvedValue(true)
  })

  it('checks the remote manually and opens the existing update dialog', async () => {
    const local = updateStatus()
    const available = updateStatus({
      update_available: true,
      remote_version: '1.11.0',
      remote_sha: '2222222222222222',
      behind: 2,
      dirty: true,
    })
    mocks.fetchPluginUpdateStatus.mockResolvedValueOnce(local).mockResolvedValueOnce(available)

    renderWithPlugins(PluginUpdateSettings)

    await waitFor(() => expect(mocks.fetchPluginUpdateStatus).toHaveBeenCalledWith(false))
    expect(screen.getByText(/force-overwrites tracked plugin files/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    await waitFor(() => expect(mocks.fetchPluginUpdateStatus).toHaveBeenLastCalledWith(true))
    await waitFor(() => expect(mocks.presentPluginUpdate).toHaveBeenCalledWith(available))
    expect(screen.getByText(/including modified shipped workflows/i)).toBeInTheDocument()
  })

  it('reports when the plugin is already current', async () => {
    mocks.fetchPluginUpdateStatus.mockResolvedValue(updateStatus())
    renderWithPlugins(PluginUpdateSettings)

    await waitFor(() => expect(mocks.fetchPluginUpdateStatus).toHaveBeenCalledWith(false))
    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }))

    expect(await screen.findByText('ComfyTV is up to date.')).toBeInTheDocument()
    expect(mocks.presentPluginUpdate).not.toHaveBeenCalled()
  })

  it('confirms and rolls back to the saved previous version', async () => {
    const rollbackReady = updateStatus({
      rollback_available: true,
      rollback_version: '1.9.0',
      rollback_sha: 'aaaaaaaaaaaa',
      backup_path: 'C:/backup/update-1',
      local_backups: ['workflows/model/mine.json.local-backup'],
    })
    const rolledBack = updateStatus({ rolled_back: true, local_version: '1.9.0' })
    mocks.fetchPluginUpdateStatus.mockResolvedValue(rollbackReady)
    mocks.rollbackPluginUpdate.mockResolvedValue(rolledBack)

    renderWithPlugins(PluginUpdateSettings)

    expect(await screen.findByText('Rollback is available to v1.9.0.')).toBeInTheDocument()
    expect(screen.getByText(/1 local file.*local-backup/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /rollback version/i }))

    expect(mocks.askConfirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }))
    await waitFor(() => expect(mocks.rollbackPluginUpdate).toHaveBeenCalledTimes(1))
    expect(mocks.presentPluginRestart).toHaveBeenCalledTimes(1)
  })
})
