import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

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

test('Photoshop job state does not move backwards after receiving a result', () => {
  const state = stateMachine()
  assert.equal(state.acceptJobPhase('job', 'queued'), true)
  assert.equal(state.acceptJobPhase('job', 'running'), true)
  assert.equal(state.acceptJobPhase('job', 'result_received'), true)
  assert.equal(state.acceptJobPhase('job', 'running'), false)
  assert.equal(state.acceptJobPhase('job', 'completed'), true)
  assert.equal(state.acceptJobPhase('job', 'interrupted'), false)
})

test('Photoshop job state rejects results after interruption', () => {
  const state = stateMachine()
  assert.equal(state.acceptJobPhase('job', 'queued'), true)
  assert.equal(state.acceptJobPhase('job', 'interrupted'), true)
  assert.equal(state.acceptJobPhase('job', 'result_received'), false)
  assert.equal(state.acceptJobPhase('job', 'completed'), false)
})
