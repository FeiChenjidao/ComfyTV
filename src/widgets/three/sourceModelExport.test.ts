import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '@/lib/comfyApp'
import { downloadBlob, downloadFile } from '@/utils/download'
import { exportSourceModel } from './sourceModelExport'

vi.mock('@/utils/download', async (original) => ({
  ...await original<typeof import('@/utils/download')>(),
  downloadBlob: vi.fn(),
  downloadFile: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

describe('sourceModelExport', () => {
  it('downloads the provider FBX unchanged', async () => {
    const url = '/view?filename=quad.FBX&type=output'
    expect(await exportSourceModel(url, 'fbx')).toBe(true)
    expect(downloadFile).toHaveBeenCalledWith(url)
    expect(app.api.fetchApi).not.toHaveBeenCalled()
  })

  it.each([
    ['quad.fbx', 'obj'], ['mixed.obj', 'fbx'], ['quad.obj', 'obj'],
  ] as const)('exports original polygons from %s as %s', async (filename, format) => {
    const url = `/view?filename=${filename}&type=output`
    vi.mocked(app.api.fetchApi).mockResolvedValueOnce(new Response('archive bytes', {
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''converted.zip" },
    }))
    expect(await exportSourceModel(url, format)).toBe(true)
    const request = String(vi.mocked(app.api.fetchApi).mock.calls[0][0])
    const params = new URL(request, 'http://localhost').searchParams
    expect(params.get('url')).toBe(url)
    expect(params.get('format')).toBe(format)
    expect(downloadBlob).toHaveBeenCalledWith('converted.zip', expect.any(Blob))
  })

  it('reports conversion failure without falling back to triangulated export', async () => {
    vi.mocked(app.api.fetchApi).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Missing texture' }), { status: 400 }))
    await expect(exportSourceModel('/view?filename=quad.fbx', 'obj')).rejects.toThrow('Missing texture')
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it.each([['mesh.glb', 'fbx'], ['mesh.fbx', 'glb'], ['mesh.obj', 'stl']] as const)(
    'leaves %s to %s to the existing triangle exporter', async (filename, format) => {
      expect(await exportSourceModel(`/view?filename=${filename}`, format)).toBe(false)
      expect(app.api.fetchApi).not.toHaveBeenCalled()
    },
  )
})
