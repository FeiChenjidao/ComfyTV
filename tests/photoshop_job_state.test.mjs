import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const start = source.indexOf('const jobPhaseRanks = new Map()')
const end = source.indexOf('function batchCount()', start)

function stateMachine() {
  if (start < 0 || end < 0) throw new Error('Photoshop job state machine was not found')
  const context = { Map }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)}\n` +
    'globalThis.acceptJobPhase = acceptJobPhase; globalThis.jobPhases = jobPhases;', context)
  return context
}

describe('Photoshop job state machine', () => {
  it('does not move backwards after the result is received', () => {
    const state = stateMachine()
    expect(state.acceptJobPhase('job', 'queued')).toBe(true)
    expect(state.acceptJobPhase('job', 'running')).toBe(true)
    expect(state.acceptJobPhase('job', 'result_received')).toBe(true)
    expect(state.acceptJobPhase('job', 'running')).toBe(false)
    expect(state.acceptJobPhase('job', 'completed')).toBe(true)
    expect(state.acceptJobPhase('job', 'interrupted')).toBe(false)
  })

  it('rejects a result after the task was stopped', () => {
    const state = stateMachine()
    expect(state.acceptJobPhase('job', 'queued')).toBe(true)
    expect(state.acceptJobPhase('job', 'interrupted')).toBe(true)
    expect(state.acceptJobPhase('job', 'result_received')).toBe(false)
    expect(state.acceptJobPhase('job', 'completed')).toBe(false)
  })
})
