import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachComfyOrgAuth } from './comfyOrgAuth'

describe('attachComfyOrgAuth', () => {
  afterEach(() => {
    delete (window as any).__comfytv_host_pinia
    vi.unstubAllGlobals()
  })

  it('is a no-op on a missing api', async () => {
    await expect(attachComfyOrgAuth(null)).resolves.toBeUndefined()
  })

  it('copies getAuthStore token onto api.authToken', async () => {
    const api: any = {
      waitForAuthInitialization: vi.fn().mockResolvedValue(undefined),
      getAuthStore: vi.fn().mockResolvedValue({
        getAuthToken: vi.fn().mockResolvedValue('jwt-from-store'),
      }),
    }
    await attachComfyOrgAuth(api)
    expect(api.authToken).toBe('jwt-from-store')
  })

  it('reads the host pinia auth store when getAuthStore is empty', async () => {
    const pinia = {
      _s: new Map([
        ['firebaseAuth', { getAuthToken: vi.fn().mockResolvedValue('pinia-jwt') }],
        ['apiKeyAuth', { getApiKey: vi.fn().mockReturnValue('comfyui-key') }],
      ]),
    }
    ;(window as any).__comfytv_host_pinia = pinia
    const api: any = {}
    await attachComfyOrgAuth(api)
    expect(api.authToken).toBe('pinia-jwt')
    expect(api.apiKey).toBe('comfyui-key')
  })

  it('does not overwrite with empty values', async () => {
    const api: any = { authToken: 'keep-me' }
    await attachComfyOrgAuth(api)
    expect(api.authToken).toBe('keep-me')
  })

  it('does not overwrite host-attached workspace credentials', async () => {
    const pinia = {
      _s: new Map([
        ['auth', {
          getWorkspaceAuthToken: vi.fn().mockResolvedValue('wrong-workspace'),
          getAuthToken: vi.fn().mockResolvedValue('wrong-firebase'),
        }],
        ['apiKeyAuth', { getApiKey: vi.fn().mockReturnValue('wrong-key') }],
      ]),
    }
    ;(window as any).__comfytv_host_pinia = pinia
    const api: any = { authToken: 'workspace-jwt', apiKey: 'host-key' }
    await attachComfyOrgAuth(api)
    expect(api.authToken).toBe('workspace-jwt')
    expect(api.apiKey).toBe('host-key')
  })

  it('prefers getWorkspaceAuthToken over getAuthToken when filling', async () => {
    const pinia = {
      _s: new Map([
        ['auth', {
          getWorkspaceAuthToken: vi.fn().mockResolvedValue('workspace-jwt'),
          getAuthToken: vi.fn().mockResolvedValue('firebase-jwt'),
        }],
      ]),
    }
    ;(window as any).__comfytv_host_pinia = pinia
    const api: any = {}
    await attachComfyOrgAuth(api)
    expect(api.authToken).toBe('workspace-jwt')
  })
})
