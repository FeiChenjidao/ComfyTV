import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')

test('mask feather setting defaults to five percent and clamps invalid values', () => {
  assert.match(html, /id="mask-feather"[^>]*min="0"[^>]*max="50"[^>]*value="5"/)
  assert.match(html, /蒙版羽化 \(%\)/)
  const start = source.indexOf('function maskFeatherPercent()')
  const end = source.indexOf('function expandSelectionBounds(', start)
  assert.ok(start >= 0 && end > start)
  let value = '24'
  const context = { Number, Math, element: () => ({ value }) }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.readFeather = maskFeatherPercent; globalThis.radius = maskFeatherRadius;`, context)
  assert.equal(context.readFeather(), 24)
  value = '-5'
  assert.equal(context.readFeather(), 0)
  value = '5000'
  assert.equal(context.readFeather(), 50)
  value = 'bad'
  assert.equal(context.readFeather(), 5)
  assert.equal(context.radius({ left: 0, top: 0, right: 200, bottom: 100 }, 5), 5)
})

test('selection mask feathers before the white edit region is filled', () => {
  const start = source.indexOf('async function encodeSelectionMask(')
  const end = source.indexOf('function captureNote(', start)
  const maskSource = source.slice(start, end)
  assert.match(maskSource, /_obj: "feather"/)
  assert.match(maskSource, /radius: \{ _unit: "pixelsUnit", _value: feather \}/)
  assert.match(maskSource, /const feather = maskFeatherRadius\(selection, featherPercent\)/)
  assert.ok(maskSource.indexOf('_obj: "feather"') < maskSource.lastIndexOf('fillCommand("white")'))
  assert.match(source, /const maskFeather = maskFeatherPercent\(\)/)
  assert.match(source, /maskFeather,\s*\n\s*seed:/)
  assert.match(source, /maskFeatherPercent: element\("mask-feather"\)\.value/)
  assert.match(source, /localStorage\.getItem\(`\$\{STORE_PREFIX\}maskFeatherPercent`\)/)
})

test('zero feather binarizes the final mask after Photoshop resampling', () => {
  const start = source.indexOf('function buildRgbRaw(')
  const end = source.indexOf('async function rgbPngFromImageData(', start)
  const context = { Uint8Array }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.buildRaw = buildRgbRaw;`, context)
  const raw = context.buildRaw(new Uint8Array([0, 64, 127, 128, 192, 255]), 6, 1, 1, null, 'black', 3, true)
  assert.deepEqual(Array.from(raw), [
    0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    255, 255, 255,
    255, 255, 255,
    255, 255, 255,
  ])
  const maskStart = source.indexOf('async function encodeSelectionMask(')
  const maskEnd = source.indexOf('function captureNote(', maskStart)
  assert.match(source.slice(maskStart, maskEnd), /binaryMask: feather <= 0/)
})

test('Photoshop layer masks use the configured percentage and skip it at zero', () => {
  const start = source.indexOf('async function maskPlacedLayer(')
  const end = source.indexOf('async function addResultLayer(', start)
  const maskSource = source.slice(start, end)
  assert.match(maskSource, /const feather = maskFeatherRadius\(bounds\)/)
  assert.match(maskSource, /if \(feather > 0\)/)
  assert.match(maskSource, /radius: \{ _unit: "pixelsUnit", _value: feather \}/)
  assert.doesNotMatch(maskSource, /size \* 0\.01/)
})
