import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')

test('document workspace identity follows saved PSD paths and unsaved session ids', () => {
  const start = source.indexOf('function documentPathValue(')
  const end = source.indexOf('function documentWorkspaceRoot(', start)
  assert.ok(start >= 0 && end > start)
  const context = {
    Math,
    Number,
    String,
    app: {
      documents: [{}],
      activeDocument: { id: 42, name: 'Poster.PSD', path: { nativePath: 'D:\\Projects\\Campaign' } },
    },
  }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)}\n`
    + 'globalThis.describeDocument = activeDocumentWorkspaceDescriptor;\n'
    + 'globalThis.folderToken = documentWorkspaceFolderToken;', context)

  const saved = context.describeDocument()
  assert.equal(saved.identity, 'file:d:\\projects\\campaign|poster.psd')
  assert.equal(saved.name, 'Poster.PSD')
  assert.equal(context.folderToken(saved.identity), context.folderToken(saved.identity))
  assert.notEqual(context.folderToken(saved.identity), context.folderToken('file:d:\\projects\\other|poster.psd'))

  context.app.activeDocument = { id: 77, name: 'Untitled-1' }
  const unsaved = context.describeDocument()
  assert.equal(unsaved.identity, 'session:77')
  assert.equal(context.folderToken(saved.identity).startsWith('document-'), true)
})

test('document workspaces persist prompt, model parameters, presets, and binary references', () => {
  assert.match(source, /const DOCUMENT_WORKSPACE_ROOT = "document-workspaces-v1"/)
  assert.match(source, /_property: "fileReference"/)
  assert.match(source, /positive: String\(element\("positive"\)\?\.value \|\| ""\)/)
  assert.match(source, /renderProfile: \{ \.\.\.normalizeProfile\(renderProfile\) \}/)
  assert.match(source, /selectedPresetIds: \{ \.\.\.selectedPresetIds \}/)
  assert.match(source, /entry\.write\(base64ToBuffer\(file\.base64\), \{ format: storage\.formats\.binary \}\)/)
  assert.match(source, /await writeDocumentWorkspace\(previousSnapshot\)[\s\S]*await readDocumentWorkspace\(descriptor\)/)
  assert.match(source, /documentWorkspaceTimer = setInterval\(checkActiveDocumentWorkspace, 400\)/)
  assert.match(source, /data\.type === "composer-prompt"[\s\S]*scheduleDocumentWorkspaceSave\(\)/)
  assert.match(source, /await initializeDocumentWorkspaces\(\)[\s\S]*await restoreRenderHistory\(\)/)
})
