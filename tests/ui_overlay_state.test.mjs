import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const mainSource = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const htmlSource = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../runtime/photoshop-runtime-bridge.js', import.meta.url), 'utf8')

test('toolbar SVG icons stay outside native buttons for Photoshop UXP painting', () => {
  for (const id of ['settings-toggle', 'web-toggle', 'fit-toggle', 'history-toggle']) {
    assert.match(htmlSource, new RegExp(`<span id="${id}"[^>]*role="button"[^>]*tabindex="0"`))
    assert.doesNotMatch(htmlSource, new RegExp(`<button id="${id}"`))
  }
  assert.doesNotMatch(htmlSource, /class="btn-hit"/)
})

test('ComfyUI workflow button stays hidden outside ComfyUI mode', () => {
  assert.match(htmlSource, /id="web-toggle" class="rail-btn hidden"/)
  assert.match(mainSource, /element\("web-toggle"\)\?\.classList\.toggle\("hidden", mode !== RUNTIME_COMFYUI\)/)
  const styleSource = readFileSync(new URL('../photoshop-uxp-plugin/styles.css', import.meta.url), 'utf8')
  assert.match(styleSource, /\.tool-rail #web-toggle\.hidden\s*\{\s*display: none;/)
  assert.match(styleSource, /#web-toggle\.hidden \+ #fit-toggle\s*\{\s*top: 54px;/)
})

test('drawers and composer popovers are mutually exclusive', () => {
  const closeDrawersStart = mainSource.indexOf('function closeDrawers()')
  const toggleDrawerStart = mainSource.indexOf('function toggleDrawer(')
  const openPopoverStart = mainSource.indexOf('function openHostPopover(')
  assert.ok(closeDrawersStart >= 0)
  assert.ok(toggleDrawerStart > closeDrawersStart)
  assert.ok(openPopoverStart > toggleDrawerStart)

  const toggleDrawer = mainSource.slice(toggleDrawerStart, mainSource.indexOf('const referenceFiles', toggleDrawerStart))
  const openPopover = mainSource.slice(openPopoverStart, mainSource.indexOf('function mountComposerWorkbench', openPopoverStart))
  assert.match(toggleDrawer, /closeDrawers\(\)/)
  assert.match(toggleDrawer, /closeComposerMenus\(\)/)
  assert.match(openPopover, /closeDrawers\(\)[\s\S]*closeComposerMenus\(\)/)
})

test('settings opens on pointerdown instead of waiting for a delayed click', () => {
  assert.match(mainSource, /element\("settings-toggle"\)\.addEventListener\("pointerdown"/)
})

test('history categories are created from the composer menu instead of the history panel', () => {
  assert.doesNotMatch(htmlSource, /id="history-category-name"/)
  assert.doesNotMatch(htmlSource, /id="history-category-add"/)
  assert.doesNotMatch(mainSource, /createHistoryCategoryFromPanel/)
  const menuStart = mainSource.indexOf('function fillHistoryCategoryMenu(')
  const menuEnd = mainSource.indexOf('function toggleComposerMenu(', menuStart)
  assert.ok(menuStart >= 0 && menuEnd > menuStart)
  const menuSource = mainSource.slice(menuStart, menuEnd)
  assert.match(menuSource, /history-category-create-option/)
  assert.match(menuSource, /openHistoryCategoryCreate\(menu\)/)
  assert.match(menuSource, /addHistoryCategory\(input\.value\)/)
  assert.match(menuSource, /submit\.textContent = "新建"/)
  const styleSource = readFileSync(new URL('../photoshop-uxp-plugin/styles.css', import.meta.url), 'utf8')
  assert.match(styleSource, /\.history-category-create-dialog/)
})

test('preset editor defaults to suffix content and preserves advanced prefix presets', () => {
  const helperStart = mainSource.indexOf('function createHostPresetEditor(')
  const helperEnd = mainSource.indexOf('function presetCategory(', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart)
  const context = { String, Boolean }
  vm.createContext(context)
  vm.runInContext(`let hostPresetEditor = null;\n${mainSource.slice(helperStart, helperEnd)}\n`
    + 'globalThis.createDraft = createHostPresetEditor;\n'
    + 'globalThis.setDraft = (value) => { hostPresetEditor = value; };\n'
    + 'globalThis.getDraft = () => hostPresetEditor;\n'
    + 'globalThis.setAdvanced = setHostPresetEditorAdvanced;', context)

  const basic = context.createDraft({ id: 'basic', suffix: '放在后面' }, '功能')
  assert.equal(basic.advanced, false)
  assert.equal(basic.content, '放在后面')
  context.setDraft({ ...basic, content: '修改后的内容' })
  context.setAdvanced(true)
  assert.equal(context.getDraft().suffix, '修改后的内容')

  const advanced = context.createDraft({ id: 'advanced', prefix: '核心风格', suffix: '画幅限制' }, '风格')
  assert.equal(advanced.advanced, true)
  assert.equal(advanced.prefix, '核心风格')
  context.setDraft(advanced)
  context.setAdvanced(false)
  assert.equal(context.getDraft().prefix, '')
  assert.equal(context.getDraft().content, '核心风格\n画幅限制')

  const editorStart = mainSource.indexOf('if (hostPresetView === "edit" && hostPresetEditor)')
  const editorEnd = mainSource.indexOf('} else if (hostPresetView === "delete"', editorStart)
  const editorSource = mainSource.slice(editorStart, editorEnd)
  assert.match(editorSource, /label: "内容"/)
  assert.match(editorSource, /前缀权重更高/)
  assert.match(editorSource, /prefix: hostPresetEditor\.advanced[^]*: ""/)
  assert.match(editorSource, /String\(values\.content\.value \|\| ""\)\.trim\(\)/)
})

test('Seedream layers use the Photoshop DOM grouping API without native group dialogs', () => {
  const groupStart = mainSource.indexOf('async function groupPlacedLayers(')
  const groupEnd = mainSource.indexOf('async function addLayeredResult(', groupStart)
  const groupSource = mainSource.slice(groupStart, groupEnd)
  assert.match(groupSource, /document\.createLayerGroup\(\{ name, fromLayers: layers \}\)/)
  assert.doesNotMatch(groupSource, /groupLayersEvent/)
  assert.match(mainSource, /return placed\s*\n}\s*\n\s*async function groupPlacedLayers/)
})

test('GPT auto size follows the captured Photoshop dimensions', () => {
  const profileStart = mainSource.indexOf('function profilePayload(')
  const profileEnd = mainSource.indexOf('function modeButtonLabel(', profileStart)
  const profileSource = mainSource.slice(profileStart, profileEnd)
  assert.match(profileSource, /normalized\.resolution === "auto" && imageSize/)
  assert.match(profileSource, /\? "Custom"/)
})

test('plugin updates flush durable history and preset state before opening the CCX', () => {
  const updateStart = mainSource.indexOf('async function downloadAndInstallPluginUpdate(')
  const updateEnd = mainSource.indexOf('async function switchRuntimeMode(', updateStart)
  const updateSource = mainSource.slice(updateStart, updateEnd)
  assert.ok(updateSource.indexOf('await flushDurableStateBackup()') < updateSource.indexOf('downloadAndVerify'))
  assert.ok(updateSource.indexOf('await flushDocumentWorkspaceSave()') < updateSource.indexOf('downloadAndVerify'))
})

test('batch generation captures Photoshop once and reuses the frozen request', () => {
  const batchStart = mainSource.indexOf('async function renderBatch(')
  const batchEnd = mainSource.indexOf('async function sendLayer(', batchStart)
  const batchSource = mainSource.slice(batchStart, batchEnd)
  assert.match(batchSource, /const snapshot = await captureBatchRenderSnapshot/)
  assert.match(batchSource, /const jobs = createPendingRenderJobs\(snapshot, total, selectedHistoryCategoryId\)/)
  assert.match(batchSource, /jobs\.forEach\(submitRenderJob\)/)
  assert.doesNotMatch(batchSource, /await\s+submitRenderJob/)
  assert.doesNotMatch(batchSource, /captureWorkflowInput/)

  const snapshotStart = mainSource.indexOf('async function captureBatchRenderSnapshot(')
  const snapshotEnd = mainSource.indexOf('function payloadFromBatchSnapshot(', snapshotStart)
  const snapshotSource = mainSource.slice(snapshotStart, snapshotEnd)
  assert.match(snapshotSource, /captureWorkflowInput\("", 0, updateCaptureStage\)/)
  assert.match(snapshotSource, /referenceInputs: capturedReferences/)
  assert.match(snapshotSource, /workflow: capturedWorkflow/)
})

test('batch payload keeps canvas placement profile and references while rotating automatic seeds', () => {
  const start = mainSource.indexOf('function payloadFromBatchSnapshot(')
  const end = mainSource.indexOf('function submitRenderJob(', start)
  assert.ok(start >= 0 && end > start)
  const context = { String, randomSeed: () => 987654321 }
  vm.createContext(context)
  vm.runInContext(`${mainSource.slice(start, end)}\nglobalThis.payloadFromBatchSnapshot = payloadFromBatchSnapshot;`, context)
  const snapshot = {
    autoSeed: true,
    canvasBase64: 'canvas-a',
    maskBase64: 'mask-a',
    captureNote: 'captured once',
    placement: { bounds: { left: 1, top: 2, right: 101, bottom: 202 } },
    workflow: 4,
    runtimeMode: 'direct',
    referenceInputs: [{ name: 'ref-a', base64: 'ref-data' }],
    configdata: { seed: '123', customWidth: 100, customHeight: 200, positive: 'prompt-a' },
  }
  const first = context.payloadFromBatchSnapshot(snapshot, 'job-1', 0)
  const second = context.payloadFromBatchSnapshot(snapshot, 'job-2', 1)
  assert.equal(first.canvasBase64, second.canvasBase64)
  assert.equal(first.placement, second.placement)
  assert.equal(first.referenceInputs, second.referenceInputs)
  assert.equal(first.configdata.customWidth, second.configdata.customWidth)
  assert.equal(first.configdata.customHeight, second.configdata.customHeight)
  assert.equal(first.configdata.seed, '123')
  assert.equal(second.configdata.seed, '987654321')
  assert.equal(second.configdata.jobId, 'job-2')
  assert.equal(second.configdata.batchIndex, 1)
})

test('batch jobs appear in history immediately and keep independent task state', () => {
  const start = mainSource.indexOf('function createPendingRenderJobs(')
  const end = mainSource.indexOf('async function receiveRender(', start)
  assert.ok(start >= 0 && end > start)
  const source = mainSource.slice(start, end)
  assert.match(source, /renderJobs\.set\(jobId, job\)/)
  assert.match(source, /pending: true/)
  assert.match(source, /startedAt: Date\.now\(\)/)
  assert.match(source, /renderHistory\.unshift\(/)
  assert.match(source, /setHistoryOpen\(true\)/)
})

test('ComfyUI submissions carry a job id on every input message', () => {
  const start = mainSource.indexOf('function sendWorkflowPayload(')
  const end = mainSource.indexOf('function updateOptions(', start)
  const source = mainSource.slice(start, end)
  assert.match(source, /sendSocket\(\{ jobId, referenceClear: true \}\)/)
  assert.match(source, /jobId,\s*referenceBase64/)
  assert.match(source, /sendSocket\(\{ jobId, canvasBase64:/)
  assert.match(source, /sendSocket\(\{ jobId, maskBase64:/)
  assert.match(source, /queue: payload\.queue/)
})

test('ComfyUI bridge queues multiple Photoshop jobs and resets the hidden input key', () => {
  assert.match(bridgeSource, /const jobs = new Map\(\)/)
  assert.match(bridgeSource, /const promptJobs = new Map\(\)/)
  assert.match(bridgeSource, /let queueChain = Promise\.resolve\(\)/)
  assert.match(bridgeSource, /queueChain = queueChain\.catch\(\(\) => \{\}\)\.then\(\(\) => queueJob\(message\)\)/)
  assert.match(bridgeSource, /setNodeWidget\(inputNode, 'job_id', String\(message\.inputKey \|\| ''\)\)/)
  assert.match(bridgeSource, /finally \{\s*setNodeWidget\(inputNode, 'job_id', ''\)/)
  assert.doesNotMatch(bridgeSource, /已有 Photoshop 任务正在运行/)
})

test('history images stay file-backed and load the full render only after selection', () => {
  const preparedStart = mainSource.indexOf('async function writePreparedThumb(')
  const preparedEnd = mainSource.indexOf('async function referenceThumbSrc(', preparedStart)
  const preparedSource = mainSource.slice(preparedStart, preparedEnd)
  assert.match(preparedSource, /src: String\(entry\?\.url \|\| ""\)/)
  assert.doesNotMatch(preparedSource, /data:image\/png;base64/)

  const rememberStart = mainSource.indexOf('async function rememberThumb(')
  const rememberEnd = mainSource.indexOf('function ensureThumb(', rememberStart)
  const rememberSource = mainSource.slice(rememberStart, rememberEnd)
  assert.match(rememberSource, /item\.thumbSrc = String\(entry\.url \|\| ""\)/)
  assert.doesNotMatch(rememberSource, /entry\.read/)

  const restoreStart = mainSource.indexOf('async function restoreRenderHistory(')
  const restoreEnd = mainSource.indexOf('let lastRenderFileStamp', restoreStart)
  const restoreSource = mainSource.slice(restoreStart, restoreEnd)
  assert.doesNotMatch(restoreSource, /await selectHistory\(0\)/)
  assert.match(restoreSource, /element\("add-layer"\)\.disabled = true/)
})
