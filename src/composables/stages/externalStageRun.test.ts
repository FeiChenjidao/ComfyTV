import { describe, expect, it } from 'vitest'

import { shouldApplyExternalRun, type ExternalStageRunContext } from './externalStageRun'

function ctx(overrides: Partial<ExternalStageRunContext> = {}): ExternalStageRunContext {
  return {
    nodeId: 7,
    projectId: 'default',
    runPromptId: null,
    running: false,
    runStageRunId: null,
    ...overrides,
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    node_id: '7',
    status: 'done',
    external: true,
    project_id: 'default',
    ui: { output: ['/view?filename=a.png&type=output'] },
    ...overrides,
  }
}

describe('shouldApplyExternalRun', () => {
  it('accepts a finished queue run for this card', () => {
    expect(shouldApplyExternalRun(event(), ctx())).toBe(true)
  })

  it('accepts an error so the card can show it', () => {
    expect(shouldApplyExternalRun(event({ status: 'error' }), ctx())).toBe(true)
  })

  it('ignores plugin-driven events without the external marker', () => {
    expect(shouldApplyExternalRun(event({ external: false }), ctx())).toBe(false)
    expect(shouldApplyExternalRun(event({ external: undefined }), ctx())).toBe(false)
    expect(shouldApplyExternalRun(null, ctx())).toBe(false)
  })

  it('ignores other nodes', () => {
    expect(shouldApplyExternalRun(event({ node_id: '8' }), ctx())).toBe(false)
  })

  it('ignores other projects but accepts an unscoped event', () => {
    expect(shouldApplyExternalRun(event({ project_id: 'other' }), ctx())).toBe(false)
    expect(shouldApplyExternalRun(event({ project_id: '' }), ctx())).toBe(true)
  })

  it('ignores the echo of a prompt this page queued itself', () => {
    expect(shouldApplyExternalRun(
      event({ prompt_id: 'p-1' }), ctx({ runPromptId: 'p-1' }))).toBe(false)
    expect(shouldApplyExternalRun(
      event({ prompt_id: 'p-2' }), ctx({ runPromptId: 'p-1' }))).toBe(true)
  })

  it('never overwrites a run this card is driving', () => {
    expect(shouldApplyExternalRun(event(), ctx({ running: true }))).toBe(false)
    expect(shouldApplyExternalRun(event(), ctx({ runStageRunId: 'job-1' }))).toBe(false)
  })

  it('ignores in-flight statuses', () => {
    expect(shouldApplyExternalRun(event({ status: 'running' }), ctx())).toBe(false)
    expect(shouldApplyExternalRun(event({ status: 'cancelled' }), ctx())).toBe(false)
  })
})
