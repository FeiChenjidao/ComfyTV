import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')

test('mask feather setting defaults to a hard edge and clamps invalid values', () => {
  assert.match(html, /id="mask-feather"[^>]*min="0"[^>]*max="1000"[^>]*value="0"/)
  const start = source.indexOf('function maskFeatherPixels()')
  const end = source.indexOf('function expandSelectionBounds(', start)
  assert.ok(start >= 0 && end > start)
  let value = '24'
  const context = { Number, Math, element: () => ({ value }) }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.readFeather = maskFeatherPixels;`, context)
  assert.equal(context.readFeather(), 24)
  value = '-5'
  assert.equal(context.readFeather(), 0)
  value = '5000'
  assert.equal(context.readFeather(), 1000)
  value = 'bad'
  assert.equal(context.readFeather(), 0)
})

test('selection mask feathers before the white edit region is filled', () => {
  const start = source.indexOf('async function encodeSelectionMask(')
  const end = source.indexOf('function captureNote(', start)
  const maskSource = source.slice(start, end)
  assert.match(maskSource, /_obj: "feather"/)
  assert.match(maskSource, /radius: \{ _unit: "pixelsUnit", _value: feather \}/)
  assert.ok(maskSource.indexOf('_obj: "feather"') < maskSource.lastIndexOf('fillCommand("white")'))
  assert.match(source, /const maskFeather = maskFeatherPixels\(\)/)
  assert.match(source, /maskFeather,\s*\n\s*seed:/)
  assert.match(source, /maskFeather: element\("mask-feather"\)\.value/)
})
