import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchEagleStatus = vi.fn()
const importEagleItem = vi.fn()

vi.mock('@/api/eagle', () => ({
  fetchEagleStatus: (...a: unknown[]) => fetchEagleStatus(...a),
  importEagleItem: (...a: unknown[]) => importEagleItem(...a),
}))

import {
  droppedEagleAssets,
  eagleAvailable,
  isEagleDrag,
  refreshEagleAvailability,
} from './eagle'

const EAGLE_MIME = 'application/x-comfytv-eagle-item'

function transfer(mime: string, value: string): DataTransfer {
  return {
    types: [mime],
    getData: (t: string) => (t === mime ? value : ''),
  } as unknown as DataTransfer
}

function asset(id: number, media_type: string) {
  return { id, name: `a${id}`, payload_url: `/view?id=${id}`, media_type }
}

beforeEach(() => {
  vi.clearAllMocks()
  eagleAvailable.value = false
})

describe('refreshEagleAvailability', () => {
  it.each([
    ['api', true],
    ['disk', true],
    ['offline', false],
    ['disabled', false],
  ])('mode %s -> %s', async (mode, expected) => {
    fetchEagleStatus.mockResolvedValue({ enabled: true, mode, pending: 0 })
    await refreshEagleAvailability()
    expect(eagleAvailable.value).toBe(expected)
  })

  it('stays unavailable when the integration is off or the probe fails', async () => {
    fetchEagleStatus.mockResolvedValue({ enabled: false, mode: 'disabled', pending: 0 })
    await refreshEagleAvailability()
    expect(eagleAvailable.value).toBe(false)

    fetchEagleStatus.mockRejectedValue(new Error('boom'))
    await refreshEagleAvailability()
    expect(eagleAvailable.value).toBe(false)
  })

  it('shares one in-flight probe', async () => {
    fetchEagleStatus.mockResolvedValue({ enabled: true, mode: 'api', pending: 0 })
    await Promise.all([refreshEagleAvailability(), refreshEagleAvailability()])
    expect(fetchEagleStatus).toHaveBeenCalledTimes(1)
  })
})

describe('eagle drag', () => {
  it('claims only its own mime', () => {
    expect(isEagleDrag(transfer(EAGLE_MIME, 'ID1'))).toBe(true)
    expect(isEagleDrag(transfer('text/plain', 'ID1'))).toBe(false)
    expect(isEagleDrag(null)).toBe(false)
  })

  it('imports the dropped item into the asset library', async () => {
    importEagleItem.mockResolvedValue({ ok: true, asset: asset(7, 'image') })
    const attachments = await droppedEagleAssets(transfer(EAGLE_MIME, 'ID1'))
    expect(importEagleItem).toHaveBeenCalledWith('ID1')
    expect(attachments).toEqual([
      { id: 'asset:7', name: 'a7', ref: 'asset:7', previewUrl: '/view?id=7' },
    ])
  })

  it('reuses the cached row instead of importing the same item twice', async () => {
    importEagleItem.mockResolvedValue({ ok: true, asset: asset(9, 'image') })
    await droppedEagleAssets(transfer(EAGLE_MIME, 'CACHED'))
    await droppedEagleAssets(transfer(EAGLE_MIME, 'CACHED'))
    expect(importEagleItem).toHaveBeenCalledTimes(1)
  })

  it('drops media the composer cannot attach', async () => {
    importEagleItem.mockResolvedValue({ ok: true, asset: asset(8, 'model') })
    expect(await droppedEagleAssets(transfer(EAGLE_MIME, 'ID2'))).toEqual([])
  })

  it('ignores an empty payload without hitting the server', async () => {
    expect(await droppedEagleAssets(transfer(EAGLE_MIME, ''))).toEqual([])
    expect(importEagleItem).not.toHaveBeenCalled()
  })
})
