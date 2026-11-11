import assert from 'node:assert/strict'
import test from 'node:test'

await import('../photoshop-uxp-plugin/state-backup.js')
const state = globalThis.ComfyTvPersistentState

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get length() { return values.size },
    key(index) { return Array.from(values.keys())[index] ?? null },
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
  }
}

test('backs up only ComfyTV local state', () => {
  const store = memoryStorage({
    'comfytv.uxp.renderHistory': '[]',
    'comfytv.uxp.presetLibraryV2': '{"presets":[]}',
    unrelated: 'keep out',
  })
  const payload = state.snapshot(store, 'comfytv.uxp.', '0.3.12')
  assert.deepEqual(payload.values, {
    'comfytv.uxp.renderHistory': '[]',
    'comfytv.uxp.presetLibraryV2': '{"presets":[]}',
  })
})

test('restores wiped state and does not overwrite live values by default', () => {
  const payload = {
    schema: 1,
    values: {
      'comfytv.uxp.renderHistory': '[{"name":"render-1.png"}]',
      'comfytv.uxp.presetLibraryV2': '{"presets":[1]}',
      unrelated: 'ignore',
    },
  }
  const store = memoryStorage({ 'comfytv.uxp.presetLibraryV2': 'live' })
  assert.equal(state.restore(store, payload, 'comfytv.uxp.'), 1)
  assert.equal(store.getItem('comfytv.uxp.presetLibraryV2'), 'live')
  assert.equal(store.getItem('comfytv.uxp.renderHistory'), payload.values['comfytv.uxp.renderHistory'])
  assert.equal(store.getItem('unrelated'), null)
})

test('can restore a key that was missing before module defaults were created', () => {
  const payload = { schema: 1, values: { 'comfytv.uxp.presetLibraryV2': 'backup' } }
  const store = memoryStorage({ 'comfytv.uxp.presetLibraryV2': 'empty default' })
  assert.equal(state.restore(store, payload, 'comfytv.uxp.', {
    overwriteKeys: ['comfytv.uxp.presetLibraryV2'],
  }), 1)
  assert.equal(store.getItem('comfytv.uxp.presetLibraryV2'), 'backup')
})
