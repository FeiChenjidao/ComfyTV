import { describe, expect, it } from 'vitest'

import { validEnvelope } from './uxpAuthPersistence'

describe('validEnvelope', () => {
  it('migrates legacy Firebase localStorage entries', () => {
    expect(validEnvelope({ entries: {
      'firebase:authUser:test:[DEFAULT]': 'serialized',
      ignored: 'value',
    } })).toEqual({
      version: 2,
      localStorage: { 'firebase:authUser:test:[DEFAULT]': 'serialized' },
      indexedDb: [],
    })
  })

  it('keeps the versioned IndexedDB and official token snapshot', () => {
    const record = { key: 'firebase:authUser:test:[DEFAULT]', value: { uid: 'test' } }
    expect(validEnvelope({
      version: 2,
      localStorage: {},
      indexedDb: [record, { bad: true }],
      token: 'workspace-token',
      apiKey: 'api-key',
    })).toEqual({
      version: 2,
      localStorage: {},
      indexedDb: [record],
      token: 'workspace-token',
      apiKey: 'api-key',
    })
  })
})
