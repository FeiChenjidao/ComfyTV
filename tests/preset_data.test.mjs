import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

let presets
let serial = 0
const options = {
  version: 2,
  defaults: [
    { id: 'style', name: '风格', pinned: true },
    { id: 'function', name: '功能', pinned: true },
  ],
  newId(prefix = 'preset') {
    serial += 1
    return `${prefix}-${serial}`
  },
}

before(async () => {
  await import('../photoshop-uxp-plugin/preset-data.js')
  presets = globalThis.ComfyTVPresetData
})

function emptyLibrary() {
  return presets.normalizeLibrary({}, options)
}

describe('Photoshop preset data', () => {
  it('creates, edits, moves, and deletes a preset without leaving an empty user category', () => {
    const created = presets.savePreset(emptyLibrary(), {
      category: '材质', name: '玻璃', prefix: '透明', suffix: '',
    }, options)
    assert.equal(created.ok, true)
    assert.deepEqual(created.library.categories.map((item) => item.name), ['风格', '功能', '材质'])

    const edited = presets.savePreset(created.library, {
      id: created.preset.id, category: '风格', name: '玻璃渲染', prefix: '透明', suffix: '高光',
    }, options)
    assert.equal(edited.ok, true)
    assert.equal(edited.previousCategoryId, created.categoryId)
    assert.deepEqual(edited.library.categories.map((item) => item.name), ['风格', '功能'])
    assert.equal(edited.preset.categoryId, 'style')

    const removed = presets.deletePreset(edited.library, edited.preset.id, options)
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.library.presets, [])
    assert.deepEqual(removed.library.categories.map((item) => item.id), ['style', 'function'])
  })

  it('rejects duplicate names in one category but allows the same name in another category', () => {
    const first = presets.savePreset(emptyLibrary(), {
      category: '风格', name: '电影感', prefix: 'cinematic', suffix: '',
    }, options)
    const duplicate = presets.savePreset(first.library, {
      category: '风格', name: '电影感', prefix: 'other', suffix: '',
    }, options)
    const otherCategory = presets.savePreset(first.library, {
      category: '功能', name: '电影感', prefix: 'other', suffix: '',
    }, options)
    assert.equal(duplicate.ok, false)
    assert.equal(otherCategory.ok, true)
  })

  it('parses import data and applies skip or overwrite atomically', () => {
    const existing = presets.savePreset(emptyLibrary(), {
      category: '风格', name: '电影感', prefix: 'old', suffix: '',
    }, options).library
    const parsed = presets.parseImport(JSON.stringify({
      schema: 'comfytv-preset-library',
      version: 1,
      categories: [
        { name: '风格', presets: [{ name: '电影感', prefix: 'new', suffix: '' }] },
        { name: '材质', presets: [{ name: '玻璃', prefix: '', suffix: 'glass' }] },
        { name: '', presets: [] },
      ],
    }))
    assert.deepEqual(presets.summarizeImport(existing, parsed), {
      newCategories: 1, additions: 1, conflicts: 1, invalid: 1,
    })

    const skipped = presets.applyImport(existing, parsed, 'skip', options)
    assert.equal(skipped.presets.find((item) => item.name === '电影感').prefix, 'old')
    assert.equal(skipped.presets.some((item) => item.name === '玻璃'), true)

    const overwritten = presets.applyImport(existing, parsed, 'overwrite', options)
    assert.equal(overwritten.presets.find((item) => item.name === '电影感').prefix, 'new')
  })
})
