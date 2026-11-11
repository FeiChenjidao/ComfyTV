import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const mainSource = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const htmlSource = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')

test('automatic seed is enabled for fresh installs', () => {
  assert.match(htmlSource, /id="auto-seed"[^>]*checked/)
  assert.match(mainSource, /\["auto-seed", "autoSeed", true\]/)
})

test('randomSeed updates and persists the value used by generation', () => {
  const start = mainSource.indexOf('function validSeed()')
  const end = mainSource.indexOf('function sendSocket(', start)
  assert.ok(start >= 0 && end > start)
  const seedInput = { value: '1379' }
  let saves = 0
  const context = {
    element(id) {
      assert.equal(id, 'seed')
      return seedInput
    },
    saveSettings() { saves += 1 },
    Math: Object.create(Math),
    Number,
    String,
  }
  context.Math.random = () => 0.5
  vm.createContext(context)
  vm.runInContext(`${mainSource.slice(start, end)}\nglobalThis.randomSeed = randomSeed; globalThis.validSeed = validSeed;`, context)
  assert.equal(context.randomSeed(), 1073741823)
  assert.equal(seedInput.value, '1073741823')
  assert.equal(context.validSeed(), 1073741823)
  assert.equal(saves, 1)
})
