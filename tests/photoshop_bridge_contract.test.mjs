import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bridgeSource = readFileSync(new URL('../runtime/photoshop-runtime-bridge.js', import.meta.url), 'utf8')
const photoshopWorkflow = JSON.parse(readFileSync(new URL('../workflows/image/PS_NanoBanana_GPTImage.json', import.meta.url), 'utf8'))

test('prompt enhancement workflow stays out of the visible model list', () => {
  assert.match(bridgeSource, /const PROMPT_ENHANCE_GROUP = '提示词美化'/)
  assert.match(bridgeSource, /function modelRows\(\)[\s\S]*rowName\(widget\) !== PROMPT_ENHANCE_GROUP/)
  assert.match(bridgeSource, /applyPromptEnhancement\(message\.promptEnhance\)/)
  assert.match(bridgeSource, /function promptEnhancementReady\(\)/)
  const chatNode = photoshopWorkflow.nodes.find((node) => node.type === 'OpenAIChatNode')
  const sendNode = photoshopWorkflow.nodes.find((node) => node.type === '🔹SendPromptTo Photoshop Plugin')
  const promptGroup = photoshopWorkflow.groups.find((group) => group.title === '提示词美化')
  assert.equal(chatNode.title, '提示词美化')
  assert.equal(chatNode.widgets_values_named.model, 'gpt-5.6-sol')
  assert.equal(sendNode.title, '提示词美化')
  assert.ok(promptGroup)
})

test('workflow autoload waits for the ComfyUI graph and canvas', () => {
  const start = bridgeSource.indexOf('async function autoloadPhotoshopWorkflow(')
  const end = bridgeSource.indexOf('function send(payload)', start)
  const source = bridgeSource.slice(start, end)
  assert.match(source, /const comfyApp = app\(\)/)
  assert.match(source, /!comfyApp\?\.graph \|\| !comfyApp\?\.canvas/)
  assert.match(source, /await comfyApp\.loadGraphData\(workflow\)/)
})

test('Photoshop profiles map to the current GPT and Seedream nodes', () => {
  assert.match(bridgeSource, /OpenAIGPTImageNodeV2/)
  assert.match(bridgeSource, /OpenAIGPTImageNodeV3/)
  assert.match(bridgeSource, /setNodeWidget\(node, 'model\.complexity', profile\.complexity\)/)
  assert.match(bridgeSource, /ByteDanceSeedreamNodeV3/)
  assert.match(bridgeSource, /model\.size_preset/)
  const generation = photoshopWorkflow.nodes.find((node) => node.type === 'ByteDanceSeedreamNodeV3')
  const separation = photoshopWorkflow.nodes.find((node) => node.type === 'ByteDanceSeedreamLayerSeparationNode')
  assert.equal(generation.title, 'Seedream 生图')
  assert.equal(separation.title, 'Seedream 图层分离')
  assert.ok(generation.inputs.some((input) => input.name === 'model.images.image_7'))
  assert.ok(generation.inputs.some((input) => input.name === 'model.seed' && input.link))
})

test('ComfyUI bridge cancels only the requested Photoshop job', () => {
  const cancelStart = bridgeSource.indexOf('async function cancelPrompt(')
  const cancelEnd = bridgeSource.indexOf('async function interruptJob(', cancelStart)
  const cancelSource = bridgeSource.slice(cancelStart, cancelEnd)
  assert.match(cancelSource, /JSON\.stringify\(\{ delete: \[promptId\] \}\)/)
  assert.match(cancelSource, /currentPromptId === promptId/)
  assert.match(bridgeSource, /if \(cancelledJobIds\.delete\(jobId\)\) return/)
  assert.match(bridgeSource, /job\.cancelRequested \|\| job\.terminal/)
  assert.match(bridgeSource, /cancelledPromptIds\.has\(promptId\)/)
})

test('ComfyUI bridge queues multiple Photoshop jobs and resets the input key', () => {
  assert.match(bridgeSource, /const jobs = new Map\(\)/)
  assert.match(bridgeSource, /const promptJobs = new Map\(\)/)
  assert.match(bridgeSource, /let queueChain = Promise\.resolve\(\)/)
  assert.match(bridgeSource, /queueChain = queueChain\.catch\(\(\) => \{\}\)\.then\(\(\) => queueJob\(message\)\)/)
  assert.match(bridgeSource, /setNodeWidget\(inputNode, 'job_id', String\(message\.inputKey \|\| ''\)\)/)
  assert.match(bridgeSource, /finally \{\s*setNodeWidget\(inputNode, 'job_id', ''\)/)
  assert.doesNotMatch(bridgeSource, /已有 Photoshop 任务正在运行/)
})
