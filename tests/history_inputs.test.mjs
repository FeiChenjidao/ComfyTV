import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mainSource = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const htmlSource = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')

test('history records persist a shared request snapshot with prompt and references', () => {
  assert.match(mainSource, /async function archiveHistoryRequest\(snapshot\)/)
  assert.match(mainSource, /prompt:\s*\{[\s\S]*user:\s*inputState\.positive[\s\S]*compiled:\s*snapshot\.configdata\?\.positive/)
  assert.match(mainSource, /snapshot\.historyRequest = await archiveHistoryRequest\(snapshot\)[\s\S]*createPendingRenderJobs/)
  assert.match(mainSource, /request:\s*normalizeHistoryRequest\(snapshot\.historyRequest\)/)
  assert.match(mainSource, /request:\s*normalizeHistoryRequest\(item\.request\)/)
})

test('right clicking either history surface restores prompt references and model state', () => {
  assert.match(mainSource, /history-panel-grid"\)\.addEventListener\("contextmenu"[\s\S]*restoreHistoryRequest/)
  assert.match(mainSource, /historyStrip\.addEventListener\("contextmenu"[\s\S]*restoreHistoryRequest/)
  assert.match(mainSource, /async function restoreHistoryRequest\(item\)[\s\S]*element\("positive"\)\.value[\s\S]*referenceFiles\.splice/)
  assert.match(mainSource, /request\.runtimeMode && request\.runtimeMode !== runtimeMode[\s\S]*switchRuntimeMode\(request\.runtimeMode, \{ silent: true \}\)/)
})

test('history restore uses the user prompt and never exposes internal mask instructions', () => {
  assert.match(mainSource, /function historyPromptForRestore\(request\)/)
  assert.match(mainSource, /if \(userPrompt\.trim\(\)\) return userPrompt/)
  assert.match(mainSource, /stripInternalWorkflowPrompt\(prompt\.compiled\)/)
  assert.match(mainSource, /\^\(\?:Mask\[：:\]\|风格/)
  assert.match(mainSource, /element\("positive"\)\.value = historyPromptForRestore\(request\)/)
  assert.match(mainSource, /selectedPresetIds = \{ \.\.\.request\.selectedPresetIds \}/)
  assert.doesNotMatch(mainSource, /const completePrompt = request\.prompt\.compiled \|\| request\.prompt\.user/)
})

test('history storage can use a persistent custom folder and clear only caches', () => {
  for (const id of ['history-storage-path', 'history-storage-pick', 'history-storage-default', 'history-storage-open', 'history-cache-clear']) {
    assert.match(htmlSource, new RegExp(`id="${id}"`))
  }
  assert.match(mainSource, /createPersistentToken\(target\)/)
  assert.match(mainSource, /getEntryForPersistentToken\(token\)/)
  assert.match(mainSource, /async function copyManagedHistory/)
  assert.match(mainSource, /async function syncEntryTree\(source, targetFolder\)/)
  assert.match(mainSource, /const sourceNames = new Set\(entries\.map\(\(entry\) => entry\.name\)\)/)
  assert.match(mainSource, /historyManagedEntry\(entry\) && !managedNames\.has\(entry\.name\)[\s\S]*deleteEntryTree\(entry\)/)
  assert.match(mainSource, /已清理 \$\{removed\} 个缓存文件，历史原图已保留/)
})

test('history input snapshots are pruned after startup recovery', () => {
  const start = mainSource.indexOf('async function restoreRenderHistory()')
  const end = mainSource.indexOf('let lastRenderFileStamp', start)
  const source = mainSource.slice(start, end)
  assert.match(source, /pruneHistoryInputFolders\(\)\.catch\(\(\) => \{\}\)/)
})
