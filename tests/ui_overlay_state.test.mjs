import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const mainSource = readFileSync(new URL('../photoshop-uxp-plugin/main.js', import.meta.url), 'utf8')
const htmlSource = readFileSync(new URL('../photoshop-uxp-plugin/index.html', import.meta.url), 'utf8')
const bridgeSource = readFileSync(new URL('../runtime/photoshop-runtime-bridge.js', import.meta.url), 'utf8')
const photoshopWorkflow = JSON.parse(readFileSync(new URL('../workflows/image/PS_NanoBanana_GPTImage.json', import.meta.url), 'utf8'))

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

test('image-aware prompt enhancement is exposed in direct and ComfyUI modes', () => {
  assert.match(htmlSource, /id="prompt-enhance" class="tiny-btn hidden"/)
  assert.match(htmlSource, /data-icon="spark-button"/)
  assert.match(mainSource, /element\("prompt-enhance"\)\?\.classList\.remove\("hidden"\)/)
  assert.match(mainSource, /ComfyDirectApi\.enhancePrompt/)
  assert.match(mainSource, /promptEnhance:\s*\{[\s\S]*prompt:\s*promptEnhancementInstruction\(currentPrompt\)/)
  assert.match(mainSource, /message\.promptEnhancement/)
})

test('prompt enhancement workflow stays out of the visible model list', () => {
  assert.match(bridgeSource, /const PROMPT_ENHANCE_GROUP = '提示词美化'/)
  assert.match(bridgeSource, /function modelRows\(\)[\s\S]*rowName\(widget\) !== PROMPT_ENHANCE_GROUP/)
  assert.match(bridgeSource, /applyPromptEnhancement\(message\.promptEnhance\)/)
  assert.match(bridgeSource, /function promptEnhancementReady\(\)/)
  assert.match(bridgeSource, /当前 ComfyUI 工作流没有提示词美化节点/)
  const chatNode = photoshopWorkflow.nodes.find((node) => node.type === 'OpenAIChatNode')
  const sendNode = photoshopWorkflow.nodes.find((node) => node.type === '🔹SendPromptTo Photoshop Plugin')
  const promptGroup = photoshopWorkflow.groups.find((group) => group.title === '提示词美化')
  const canvasLink = photoshopWorkflow.links.find((link) => link[0] === 150)
  const resultLink = photoshopWorkflow.links.find((link) => link[0] === 151)
  assert.equal(chatNode.title, '提示词美化')
  assert.equal(chatNode.widgets_values_named.model, 'gpt-5.6-sol')
  assert.equal(sendNode.title, '提示词美化')
  assert.ok(promptGroup)
  assert.deepEqual(canvasLink.slice(1, 5), [1, 0, 37, 3])
  assert.deepEqual(resultLink.slice(1, 5), [37, 0, 38, 0])
  const muter = photoshopWorkflow.nodes.find((node) => node.type === 'Fast Groups Muter (rgthree)' && node.title.includes('工作流'))
  assert.match(muter.properties.matchTitle, /提示词美化/)
})

test('workflow autoload waits for the ComfyUI graph and canvas', () => {
  const start = bridgeSource.indexOf('async function autoloadPhotoshopWorkflow(')
  const end = bridgeSource.indexOf('function send(payload)', start)
  const source = bridgeSource.slice(start, end)
  assert.match(source, /const comfyApp = app\(\)/)
  assert.match(source, /!comfyApp\?\.graph \|\| !comfyApp\?\.canvas/)
  assert.match(source, /await comfyApp\.loadGraphData\(workflow\)/)
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
  assert.match(mainSource, /menu\.classList\.toggle\("is-editor-view", hostPresetView === "edit"\)/)
  const styleSource = readFileSync(new URL('../photoshop-uxp-plugin/styles.css', import.meta.url), 'utf8')
  assert.match(styleSource, /\.host-preset-menu\.is-editor-view\s*\{\s*height: min\(420px, 100%\);/)
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

test('GPT Image 2.6 exposes complexity and remains compatible with official V2 and V3 nodes', () => {
  assert.match(mainSource, /gpt-image-2\.6-flare/)
  assert.match(mainSource, /gpt-image-2\.6-sunburst/)
  assert.match(mainSource, /function profileComplexities\(/)
  assert.match(mainSource, /chooseRenderProfile\(\{ complexity: item\.value \}\)/)
  assert.match(bridgeSource, /OpenAIGPTImageNodeV2/)
  assert.match(bridgeSource, /OpenAIGPTImageNodeV3/)
  assert.match(bridgeSource, /setNodeWidget\(node, 'model\.complexity', profile\.complexity\)/)
})

test('Seedream image generation is separate from layer separation in direct and ComfyUI modes', () => {
  assert.match(htmlSource, /Seedream 生图/)
  assert.match(mainSource, /seedreamImage:/)
  assert.match(mainSource, /function fitSeedreamImageSize\(/)
  assert.match(mainSource, /function seedreamImagePreset\(/)
  assert.match(bridgeSource, /ByteDanceSeedreamNodeV3/)
  assert.match(bridgeSource, /model\.size_preset/)
  const generation = photoshopWorkflow.nodes.find((node) => node.type === 'ByteDanceSeedreamNodeV3')
  const separation = photoshopWorkflow.nodes.find((node) => node.type === 'ByteDanceSeedreamLayerSeparationNode')
  assert.equal(generation.title, 'Seedream 生图')
  assert.equal(separation.title, 'Seedream 图层分离')
  assert.ok(generation.inputs.some((input) => input.name === 'model.images.image_7'))
  assert.ok(generation.inputs.some((input) => input.name === 'model.seed' && input.link))
  const captureStart = mainSource.indexOf('async function captureWorkflowInput(')
  const captureEnd = mainSource.indexOf('async function encodeActiveLayers(', captureStart)
  const captureSource = mainSource.slice(captureStart, captureEnd)
  assert.match(captureSource, /model: profile\.model/)
  assert.match(captureSource, /sizePreset: profile\.sizePreset/)
})

test('direct Seedream results normalize JPEG or WebP to PNG before history storage', () => {
  assert.match(mainSource, /async function normalizeDirectResultImage\(image\)/)
  assert.match(mainSource, /let directResultConversionQueue = Promise\.resolve\(\)/)
  assert.match(mainSource, /function enqueueDirectResultConversion\(image\)/)
  assert.match(mainSource, /const resultBase64 = await enqueueDirectResultConversion\(result\.images\[0\]\)/)
  assert.match(mainSource, /commandName: "Convert generated image", timeOut: 15000/)
  assert.match(mainSource, /await receiveRender\(resultBase64, "", result\.layered, job\)/)
})

test('Seedream image settings use concrete size presets instead of resolution and aspect controls', () => {
  const fillStart = mainSource.indexOf('function fillModeSheet(')
  const fillEnd = mainSource.indexOf('function syncComposer()', fillStart)
  const fillSource = mainSource.slice(fillStart, fillEnd)
  assert.match(mainSource, /function seedreamImageSizeChoices\(/)
  assert.match(mainSource, /label: `\(\$\{resolution\}\) \$\{String\(dimensions\)\.replace\("x", "×"\)\} \(\$\{aspect\}\)`/)
  assert.match(fillSource, /profile\.family !== "gpt" && profile\.family !== "seedreamImage"/)
  assert.match(fillSource, /appendSection\(menu, "尺寸"\)/)
  assert.match(fillSource, /sizeRow\.className = "mode-chip-row mode-size-chip-row"/)
  assert.match(fillSource, /appendChip\(sizeRow, choice\.label, choice\.value === selectedSize/)
  assert.match(fillSource, /const currentSize = seedreamImagePreset\(profile\)/)
  assert.match(fillSource, /customWidth: currentSize\.width/)
  assert.match(fillSource, /customHeight: currentSize\.height/)
  assert.doesNotMatch(fillSource, /mode-size-select/)
  assert.doesNotMatch(fillSource, /document\.createElement\("select"\)/)
  assert.doesNotMatch(fillSource, /mode-custom-size-fields/)
  assert.doesNotMatch(fillSource, /按当前画布等比适配/)
  assert.match(mainSource, /if \(profile\.resolution === "Custom"\) return "自定义"/)
  const presetStart = mainSource.indexOf('function seedreamImagePreset(')
  const presetEnd = mainSource.indexOf('function seedreamImageSizeChoices(', presetStart)
  assert.doesNotMatch(mainSource.slice(presetStart, presetEnd), /imageSize/)
})

test('Seedream Custom sends the captured canvas width and height like GPT', () => {
  const start = mainSource.indexOf('function profilePayload(')
  const end = mainSource.indexOf('function modeButtonLabel(', start)
  const source = mainSource.slice(start, end)
  const context = {
    Number,
    normalizeProfile: (profile) => ({ ...profile }),
    seedreamImagePreset: () => ({ label: '(2K) 2048x2048 (1:1)', width: 2048, height: 2048 }),
    profileGroupName: () => 'Seedream 生图',
  }
  vm.createContext(context)
  vm.runInContext(`${source}\nglobalThis.profilePayload = profilePayload;`, context)
  const profile = context.profilePayload({
    family: 'seedreamImage',
    resolution: 'Custom',
    customWidth: 1024,
    customHeight: 1024,
  }, { width: 1776, height: 2368 })
  assert.equal(profile.sizePreset, 'Custom')
  assert.equal(profile.customWidth, 1776)
  assert.equal(profile.customHeight, 2368)
})

test('Seedream Custom rescales the transmitted canvas to the current model limits', () => {
  const start = mainSource.indexOf('function fitCaptureFrameForProfile(')
  const end = mainSource.indexOf('function sentPlaceBounds(', start)
  const source = mainSource.slice(start, end)
  const context = {
    Number,
    renderProfile: {},
    normalizeProfile: (profile) => ({ ...profile }),
    fitSeedreamImageSize: () => ({ width: 2866, height: 1612 }),
  }
  vm.createContext(context)
  vm.runInContext(`${source}\nglobalThis.fitFrame = fitCaptureFrameForProfile;`, context)
  const fitted = context.fitFrame(3840, 2160, null, {
    family: 'seedreamImage',
    resolution: 'Custom',
    model: 'seedream 5.5',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(fitted)), {
    width: 2866,
    height: 1612,
    padLeft: 0,
    padTop: 0,
    contentWidth: 3840,
    contentHeight: 2160,
    resample: true,
  })
  assert.equal(context.fitFrame(3840, 2160, null, {
    family: 'seedreamImage',
    resolution: '2K',
    model: 'seedream 5.5',
  }), null)
  const captureStart = mainSource.indexOf('async function captureWorkflowInput(')
  const captureEnd = mainSource.indexOf('async function encodeActiveLayers(', captureStart)
  assert.match(mainSource.slice(captureStart, captureEnd), /fitCaptureFrameForProfile\(nativeWidth, nativeHeight, overMaxFrame\(nativeWidth, nativeHeight\)\)/)
})

test('mode chips activate on pointerdown so UXP does not stop at focus', () => {
  const start = mainSource.indexOf('function appendChip(')
  const end = mainSource.indexOf('function appendSection(', start)
  const source = mainSource.slice(start, end)
  assert.match(source, /addEventListener\("pointerdown", activate\)/)
  assert.match(source, /event\.preventDefault\(\)/)
  assert.match(source, /event\.key !== "Enter" && event\.key !== " "/)
})

test('Seedream custom image sizes fit each model limits while preserving usable proportions', () => {
  const limitsStart = mainSource.indexOf('const SEEDREAM_IMAGE_LIMITS =')
  const limitsEnd = mainSource.indexOf('const RENDER_FAMILIES =', limitsStart)
  const helperStart = mainSource.indexOf('function evenDimension(')
  const helperEnd = mainSource.indexOf('function seedreamImagePreset(', helperStart)
  assert.ok(limitsStart >= 0 && limitsEnd > limitsStart && helperStart >= 0 && helperEnd > helperStart)
  const context = { Math, Number }
  vm.createContext(context)
  vm.runInContext(`${mainSource.slice(limitsStart, limitsEnd)}\n${mainSource.slice(helperStart, helperEnd)}\nglobalThis.fit = fitSeedreamImageSize;`, context)

  const cases = [
    ['seedream 5.5', 10000, 100],
    ['seedream 5.0 pro', 7000, 500],
    ['seedream 5.0 lite', 500, 7000],
  ]
  for (const [model, width, height] of cases) {
    const fitted = context.fit(model, width, height)
    const limits = context.SEEDREAM_IMAGE_LIMITS?.[model]
      || vm.runInContext(`SEEDREAM_IMAGE_LIMITS[${JSON.stringify(model)}]`, context)
    assert.ok(fitted.width >= limits.minSide && fitted.height >= limits.minSide)
    assert.ok(fitted.width <= limits.maxWidth && fitted.height <= limits.maxHeight)
    assert.ok(fitted.width * fitted.height >= limits.minPixels)
    assert.ok(fitted.width * fitted.height <= limits.maxPixels)
    if (limits.maxRatio) assert.ok(Math.max(fitted.width / fitted.height, fitted.height / fitted.width) <= limits.maxRatio)
  }
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
  assert.match(batchSource, /submitRenderBatch\(jobs\)/)
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
    configdata: { seed: '123', model: 'seedream 5.5', sizePreset: 'Custom', customWidth: 100, customHeight: 200, positive: 'prompt-a' },
  }
  const first = context.payloadFromBatchSnapshot(snapshot, 'job-1', 0)
  const second = context.payloadFromBatchSnapshot(snapshot, 'job-2', 1)
  assert.equal(first.canvasBase64, second.canvasBase64)
  assert.equal(first.placement, second.placement)
  assert.equal(first.referenceInputs, second.referenceInputs)
  assert.equal(first.configdata.customWidth, second.configdata.customWidth)
  assert.equal(first.configdata.customHeight, second.configdata.customHeight)
  assert.equal(second.configdata.model, 'seedream 5.5')
  assert.equal(second.configdata.sizePreset, 'Custom')
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

test('a background batch result does not replace the history item the user is viewing', () => {
  const start = mainSource.indexOf('async function receiveRender(')
  const end = mainSource.indexOf('function renderStamp(', start)
  const source = mainSource.slice(start, end)
  assert.match(source, /const activateResult = !job \|\| renderHistory\[selectedHistoryIndex\] === item/)
  assert.match(source, /if \(activateResult\) \{[\s\S]*showPreview\("", file\.url\)[\s\S]*element\("add-layer"\)\.disabled = false/)
})

test('pending history cards expose a hover cancel control for one job only', () => {
  const styleSource = readFileSync(new URL('../photoshop-uxp-plugin/styles.css', import.meta.url), 'utf8')
  assert.match(mainSource, /function appendHistoryJobCancel\(card, item\)/)
  assert.match(mainSource, /cancel\.dataset\.jobId = String\(item\.jobId\)/)
  assert.match(mainSource, /sendSocket\(\{ protocolVersion: WORKFLOW_PROTOCOL_VERSION, jobId: id, interrupt: true \}\)/)
  assert.match(mainSource, /directAbortControllers\.get\(id\)/)
  assert.match(mainSource, /failRenderJob\(id, new Error\("已取消"\), "interrupted"\)/)
  assert.match(styleSource, /\.history-panel-card\.pending:hover \.history-job-cancel/)
  assert.match(styleSource, /\.history-card\.pending:hover \.history-job-cancel/)
})

test('ComfyUI bridge cancels queued Photoshop jobs without interrupting a different prompt', () => {
  const cancelStart = bridgeSource.indexOf('async function cancelPrompt(')
  const cancelEnd = bridgeSource.indexOf('async function interruptJob(', cancelStart)
  const cancelSource = bridgeSource.slice(cancelStart, cancelEnd)
  assert.match(cancelSource, /JSON\.stringify\(\{ delete: \[promptId\] \}\)/)
  assert.match(cancelSource, /currentPromptId === promptId/)
  assert.match(bridgeSource, /if \(cancelledJobIds\.delete\(jobId\)\) return/)
  assert.match(bridgeSource, /job\.cancelRequested \|\| job\.terminal/)
  assert.match(bridgeSource, /cancelledPromptIds\.has\(promptId\)/)
})

test('ComfyUI batches upload large inputs once and queue jobs with independent ids', () => {
  const start = mainSource.indexOf('function sendWorkflowInputs(')
  const end = mainSource.indexOf('function promptEnhancementInstruction(', start)
  const source = mainSource.slice(start, end)
  assert.match(source, /sendSocket\(\{ inputKey, referenceClear: true \}\)/)
  assert.match(source, /inputKey,\s*referenceBase64/)
  assert.match(source, /sendSocket\(\{ inputKey, canvasBase64:/)
  assert.match(source, /sendSocket\(\{ inputKey, maskBase64:/)
  assert.match(source, /queue: payload\.queue/)
  assert.match(source, /batchInputKey: String\(options\.batchInputKey \|\| ""\)/)
  const batchStart = mainSource.indexOf('function submitRenderBatch(')
  const batchEnd = mainSource.indexOf('async function renderBatch(', batchStart)
  const batchSource = mainSource.slice(batchStart, batchEnd)
  assert.match(batchSource, /sendWorkflowInputs\(jobs\[0\]\.payload, inputKey\)/)
  assert.match(batchSource, /uploadInputs: false/)
  assert.match(batchSource, /batchFinal: index === jobs\.length - 1/)
})

test('ComfyUI batch uploads fall back to per-job inputs on an older backend', () => {
  assert.match(mainSource, /let comfyCapabilities = \{ batchInputs: false \}/)
  assert.match(mainSource, /comfyCapabilities = \{ batchInputs: status\?\.batchInputs === true \}/)
  assert.match(mainSource, /jobs\[0\]\.mode === RUNTIME_DIRECT \|\| !comfyCapabilities\.batchInputs[\s\S]*jobs\.forEach\(submitRenderJob\)/)
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
