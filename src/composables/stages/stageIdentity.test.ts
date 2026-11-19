import { describe, expect, it, vi } from 'vitest'

import { app } from '@/lib/comfyApp'
import { claimStageUid, ensureStageUid, getStageUid, releaseStageUid, stageClassName, getStageUidClaimedAt, ensureStageUidClaimedAt, stageInstanceKey } from './stageIdentity'

describe('ensureStageUid (claim timestamp)', () => {
  it('records when a uid was first minted', () => {
    const node: any = { properties: {} }
    ensureStageUid(node)
    expect(typeof node.properties.comfytv_stage_uid_at).toBe('string')
    expect(getStageUidClaimedAt(node)).toBe(node.properties.comfytv_stage_uid_at)
    const at = node.properties.comfytv_stage_uid_at
    ensureStageUid(node)
    expect(node.properties.comfytv_stage_uid_at).toBe(at)
    const legacy: any = { properties: { comfytv_stage_uid: 'legacy' } }
    expect(getStageUidClaimedAt(legacy)).toBeNull()
    const minted = ensureStageUidClaimedAt(legacy)
    expect(legacy.properties.comfytv_stage_uid_at).toBe(minted)
    expect(ensureStageUidClaimedAt(legacy)).toBe(minted)
  })
})

describe('ensureStageUid', () => {
  it('returns empty string for a missing node', () => {
    expect(ensureStageUid(null)).toBe('')
    expect(ensureStageUid(undefined)).toBe('')
  })

  it('creates a uid and persists it on the node', () => {
    const node: any = {}
    const uid = ensureStageUid(node)
    expect(uid).toBeTruthy()
    expect(node.properties.comfytv_stage_uid).toBe(uid)
  })

  it('is idempotent — same uid on repeated calls', () => {
    const node: any = {}
    expect(ensureStageUid(node)).toBe(ensureStageUid(node))
  })

  it('initialises a non-object properties bag', () => {
    const node: any = { properties: 'bad' }
    const uid = ensureStageUid(node)
    expect(typeof node.properties).toBe('object')
    expect(node.properties.comfytv_stage_uid).toBe(uid)
  })

  it('replaces an empty/invalid existing uid', () => {
    const node: any = { properties: { comfytv_stage_uid: '' } }
    expect(ensureStageUid(node)).not.toBe('')
    const node2: any = { properties: { comfytv_stage_uid: 123 } }
    expect(typeof ensureStageUid(node2)).toBe('string')
  })
})

describe('getStageUid', () => {
  it('reads an existing uid or returns empty', () => {
    expect(getStageUid({ properties: { comfytv_stage_uid: 'abc' } })).toBe('abc')
    expect(getStageUid({})).toBe('')
    expect(getStageUid(null)).toBe('')
    expect(getStageUid({ properties: { comfytv_stage_uid: 7 } })).toBe('')
  })
})

describe('claimStageUid / releaseStageUid', () => {
  function setWorkflow(path: string) {
    ;(app as any).extensionManager = { workflow: { activeWorkflow: { path } } }
  }

  it('returns empty string for a missing node', () => {
    expect(claimStageUid(null)).toBe('')
    expect(claimStageUid(undefined)).toBe('')
  })

  it('generates and claims a uid for a fresh node', () => {
    const node: any = { id: 1 }
    const uid = claimStageUid(node)
    expect(uid).toBeTruthy()
    expect(node.properties.comfytv_stage_uid).toBe(uid)
  })

  it('is stable across repeated claims by the same node', () => {
    const node: any = { id: 1 }
    const uid = claimStageUid(node)
    expect(claimStageUid(node)).toBe(uid)
    expect(claimStageUid(node)).toBe(uid)
  })

  it('regenerates the uid for a clone claiming an already-owned uid', () => {
    setWorkflow('workflows/clone-test.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original: any = { id: 1 }
    const uid = claimStageUid(original)
    const clone: any = { id: 2, properties: { comfytv_stage_uid: uid } }
    const cloneUid = claimStageUid(clone)
    expect(cloneUid).not.toBe(uid)
    expect(clone.properties.comfytv_stage_uid).toBe(cloneUid)
    expect(original.properties.comfytv_stage_uid).toBe(uid)
    expect(claimStageUid(original)).toBe(uid)
    warn.mockRestore()
  })

  it('keeps the uid across release + re-claim (tab switch)', () => {
    setWorkflow('workflows/tab-switch.json')
    const node: any = { id: 1 }
    const uid = claimStageUid(node)
    releaseStageUid(node)
    const reloaded: any = { id: 1, properties: { comfytv_stage_uid: uid } }
    expect(claimStageUid(reloaded)).toBe(uid)
  })

  it('survives repeated clear + reconfigure cycles without drift', () => {
    setWorkflow('workflows/reconfigure.json')
    let node: any = { id: 7 }
    const uid = claimStageUid(node)
    for (let i = 0; i < 5; i++) {
      releaseStageUid(node)
      node = { id: 7, properties: { comfytv_stage_uid: uid } }
      expect(claimStageUid(node)).toBe(uid)
    }
  })

  it('releases a stale claim when configure replaced the uid', () => {
    setWorkflow('workflows/replaced.json')
    const node: any = { id: 1 }
    const first = claimStageUid(node)
    node.properties.comfytv_stage_uid = 'configured-uid-a'
    expect(claimStageUid(node)).toBe('configured-uid-a')
    const other: any = { id: 2, properties: { comfytv_stage_uid: first } }
    expect(claimStageUid(other)).toBe(first)
  })

  it('release is a no-op for a node that never claimed', () => {
    expect(() => releaseStageUid(null)).not.toThrow()
    expect(() => releaseStageUid({ id: 9 })).not.toThrow()
  })

  it('releasing a regenerated clone does not free the original uid', () => {
    setWorkflow('workflows/release-clone.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original: any = { id: 1 }
    const uid = claimStageUid(original)
    const clone: any = { id: 2, properties: { comfytv_stage_uid: uid } }
    const cloneUid = claimStageUid(clone)
    releaseStageUid(clone)
    const intruder: any = { id: 3, properties: { comfytv_stage_uid: uid } }
    expect(claimStageUid(intruder)).not.toBe(uid)
    expect(cloneUid).not.toBe(uid)
    warn.mockRestore()
  })

  it('keeps identical stage uids isolated between workflow tabs', () => {
    setWorkflow('workflows/a.json')
    const first: any = { id: 7, properties: { comfytv_stage_uid: 'shared-uid' } }
    expect(claimStageUid(first)).toBe('shared-uid')
    const firstKey = stageInstanceKey(first)

    setWorkflow('workflows/b.json')
    const second: any = { id: 7, properties: { comfytv_stage_uid: 'shared-uid' } }
    expect(claimStageUid(second)).toBe('shared-uid')
    expect(stageInstanceKey(second)).not.toBe(firstKey)
  })

  it('allows a remounted node with the same workflow and node id to take over its uid', () => {
    setWorkflow('workflows/remount.json')
    const first: any = { id: 9, properties: { comfytv_stage_uid: 'remount-uid' } }
    expect(claimStageUid(first)).toBe('remount-uid')
    const remounted: any = { id: 9, properties: { comfytv_stage_uid: 'remount-uid' } }
    expect(claimStageUid(remounted)).toBe('remount-uid')
  })
})

describe('stageClassName', () => {
  it('strips the dotted namespace prefix', () => {
    expect(stageClassName({ comfyClass: 'ComfyTV.ImageStage' })).toBe('ImageStage')
  })

  it('falls back to type and handles no dot', () => {
    expect(stageClassName({ type: 'PlainType' })).toBe('PlainType')
    expect(stageClassName({})).toBe('')
    expect(stageClassName(null)).toBe('')
  })
})
