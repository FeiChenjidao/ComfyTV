const PS_PROTOCOL = 3
const PS_NODE = '🔹Photoshop ComfyUI Plugin'
const SEND_NODE = '🔹SendTo Photoshop Plugin'
const clientId = globalThis.crypto?.randomUUID?.() || String(Date.now())
const searchParams = new URLSearchParams(location.search)
const preferredPsClientId = searchParams.get('comfytv_ps_client') || ''
const shouldAutoloadWorkflow = searchParams.get('comfytv_ps_autoload') === '1'
let socket = null
let reconnectTimer = 0
let lastModels = ''
let listenersReady = false
const jobs = new Map()
const promptJobs = new Map()
let currentPromptId = ''
let queueChain = Promise.resolve()
let workflowAutoloadAttempts = 0
let workflowAutoloadComplete = false

const app = () => window.comfyAPI?.app?.app
const nodes = () => app()?.graph?._nodes || app()?.graph?.nodes || []
const nodeType = (node) => String(node?.comfyClass || node?.type || '')

function socketUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ps/ws?platform=cm&clientId=${encodeURIComponent(clientId)}`
}

function workflowState() {
  const list = nodes()
  const types = list.map(nodeType)
  const text = list.map((node) => `${node.id || ''}:${nodeType(node)}:${node.title || ''}`).sort().join('|')
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return {
    ready: types.includes(PS_NODE)
      && types.includes(SEND_NODE)
      && (!shouldAutoloadWorkflow || photoshopWorkflowReady()),
    workflowFingerprint: (hash >>> 0).toString(16).padStart(8, '0'),
  }
}

function photoshopWorkflowReady() {
  const types = nodes().map(nodeType)
  const modelMuter = nodes().find((node) => nodeType(node) === 'Fast Groups Muter (rgthree)' && String(node?.title || '').includes('工作流'))
  return types.includes(PS_NODE)
    && types.includes(SEND_NODE)
    && types.includes('ByteDanceSeedreamLayerSeparationNode')
    && types.includes('🔹SendLayersTo Photoshop Plugin')
    && String(modelMuter?.properties?.matchTitle || '').includes('Seedream 图层分离')
}

async function autoloadPhotoshopWorkflow() {
  if (!shouldAutoloadWorkflow || workflowAutoloadComplete || workflowAutoloadAttempts >= 20 || !app()) return
  workflowAutoloadAttempts += 1
  try {
    const response = await fetch('/comfytv/photoshop/workflow', { cache: 'no-store' })
    if (!response.ok) throw new Error(`workflow ${response.status}`)
    const workflow = await response.json()
    await app().loadGraphData(workflow)
    workflowAutoloadComplete = photoshopWorkflowReady()
    if (!workflowAutoloadComplete) throw new Error('workflow nodes are not ready')
    publishHello()
    publishModels(true)
  } catch (error) {
    console.error('photoshop workflow autoload', error)
  }
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(payload))
  return true
}

function publishHello() {
  send({ bridgeHello: {
    protocolVersion: PS_PROTOCOL,
    clientId,
    psClientId: preferredPsClientId,
    ...workflowState(),
  } })
}

function muter(kind) {
  return nodes().find((node) => {
    if (nodeType(node) !== 'Fast Groups Muter (rgthree)') return false
    const match = String(node?.properties?.matchTitle || '')
    const title = String(node?.title || '')
    return kind === 'model'
      ? match.includes('^(NanoBanana') || title.includes('工作流')
      : match.includes('NanoBanana 1K') || title.includes('模式')
  })
}

function rowName(widget) {
  const label = String(widget?.label || '')
  if (label.startsWith('Enable ')) return label.slice(7)
  const name = String(widget?.name || '').replace(/^Enable /, '')
  return name === 'RGTHREE_TOGGLE_AND_NAV' ? '' : name
}

function rows(kind) {
  return (muter(kind)?.widgets || []).filter((widget) => typeof widget.doModeChange === 'function' && rowName(widget))
}

function setNodeWidget(node, name, value) {
  if (!node || value === undefined || value === null) return
  const widget = (node.widgets || []).find((item) => String(item?.name || item?.label || '') === name)
  if (!widget) return
  widget.value = value
  if (node.widgets_values_named && typeof node.widgets_values_named === 'object') {
    node.widgets_values_named[name] = value
  }
  try { widget.callback?.(value, app()?.canvas, node) } catch (_) {}
}

function photoshopInputNode() {
  return nodes().find((node) => nodeType(node) === PS_NODE)
}

function profileNode(profile) {
  if (profile?.family === 'nanobanana') {
    return nodes().find((item) => nodeType(item) === 'GeminiNanoBanana2V2' || String(item?.title || '') === 'NanoBanana')
  }
  if (profile?.family === 'pro') {
    return nodes().find((item) => nodeType(item) === 'GeminiImage2Node' || String(item?.title || '') === 'NanoBanana Pro')
  }
  if (profile?.family === 'gpt') {
    return nodes().find((item) => nodeType(item) === 'OpenAIGPTImageNodeV2' || String(item?.title || '') === 'GPT')
  }
  if (profile?.family === 'seedream') {
    return nodes().find((item) => nodeType(item) === 'ByteDanceSeedreamLayerSeparationNode' || String(item?.title || '') === 'Seedream 图层分离')
  }
  return null
}

function applyNodeProfile(profile) {
  const node = profileNode(profile)
  if (!node) return
  setNodeWidget(node, 'model', profile.model)
  if (profile.family === 'nanobanana') {
    setNodeWidget(node, 'model.aspect_ratio', profile.aspect || 'auto')
    setNodeWidget(node, 'model.resolution', profile.resolution || '2K')
    setNodeWidget(node, 'model.thinking_level', profile.quality || 'MINIMAL')
    return
  }
  if (profile.family === 'pro') {
    setNodeWidget(node, 'aspect_ratio', profile.aspect || 'auto')
    setNodeWidget(node, 'resolution', profile.resolution || '2K')
    return
  }
  if (profile.family === 'seedream') {
    setNodeWidget(node, 'size', profile.resolution || 'auto')
    setNodeWidget(node, 'prompt_optimization', profile.quality || 'standard')
    return
  }
  setNodeWidget(node, 'model.size', profile.size || profile.resolution || 'auto')
  if ((profile.size || profile.resolution) === 'Custom') {
    setNodeWidget(node, 'model.custom_width', Math.max(1, Number.parseInt(profile.customWidth, 10) || 1))
    setNodeWidget(node, 'model.custom_height', Math.max(1, Number.parseInt(profile.customHeight, 10) || 1))
  }
  setNodeWidget(node, 'model.background', profile.background || 'auto')
  setNodeWidget(node, 'model.quality', profile.quality || 'high')
}

function applyProfile(profile) {
  if (!profile?.group) return
  rows('mode').find((widget) => rowName(widget) === profile.group)?.doModeChange?.(true)
  applyNodeProfile(profile)
  app()?.graph?.setDirtyCanvas?.(true, true)
}

function finishJob(job) {
  if (!job) return
  jobs.delete(job.jobId)
  if (job.promptId) promptJobs.delete(job.promptId)
  if (currentPromptId === job.promptId) currentPromptId = ''
}

function jobStatus(job, phase, extra = {}) {
  if (!job || job.terminal) return
  if (['completed', 'error', 'interrupted'].includes(phase)) job.terminal = true
  send({
    protocolVersion: PS_PROTOCOL,
    clientId,
    psClientId: job.psClientId,
    jobId: job.jobId,
    promptId: job.promptId || '',
    batchIndex: job.batchIndex,
    jobStatus: { phase, ...extra },
  })
  if (job.terminal) finishJob(job)
}

function eventPromptId(event) {
  return String(event?.detail?.prompt_id || '')
}

function jobForEvent(event) {
  const promptId = eventPromptId(event)
  if (promptId && promptJobs.has(promptId)) return promptJobs.get(promptId)
  if (promptId) {
    const waiting = Array.from(jobs.values()).find((job) => !job.terminal && !job.promptId)
    if (waiting) {
      waiting.promptId = promptId
      promptJobs.set(promptId, waiting)
      return waiting
    }
  }
  if (currentPromptId && promptJobs.has(currentPromptId)) return promptJobs.get(currentPromptId)
  const active = Array.from(jobs.values()).filter((job) => !job.terminal)
  return active.length === 1 ? active[0] : null
}

function aggregateProgress(detail) {
  const measurable = Object.values(detail?.nodes || {}).filter((item) => Number(item?.max) > 0)
  const value = measurable.reduce((sum, item) => sum + Math.max(0, Number(item?.value) || 0), 0)
  const max = measurable.reduce((sum, item) => sum + Math.max(0, Number(item?.max) || 0), 0)
  return max > 0 ? Math.max(0, Math.min(99, Math.round(value / max * 100))) : 0
}

function attachProgressListeners() {
  if (listenersReady) return true
  const api = app()?.api
  if (!api?.addEventListener) return false
  listenersReady = true
  api.addEventListener('execution_start', (event) => {
    const job = jobForEvent(event)
    if (!job) return
    const promptId = eventPromptId(event) || job.promptId
    if (promptId) {
      job.promptId = promptId
      promptJobs.set(promptId, job)
      currentPromptId = promptId
    }
    jobStatus(job, 'running', { progress: 0 })
  })
  api.addEventListener('progress', (event) => {
    const job = jobForEvent(event)
    if (!job) return
    const value = Number(event?.detail?.value)
    const max = Number(event?.detail?.max)
    if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
      jobStatus(job, 'running', { progress: Math.max(0, Math.min(99, Math.round(value / max * 100))) })
    }
  })
  api.addEventListener('progress_state', (event) => {
    const job = jobForEvent(event)
    if (!job) return
    const progress = aggregateProgress(event?.detail)
    if (progress > 0) jobStatus(job, 'running', { progress })
  })
  api.addEventListener('execution_success', (event) => {
    const job = jobForEvent(event)
    if (job) jobStatus(job, 'running', { progress: 99, message: '执行完成，等待 Photoshop 接收结果' })
  })
  api.addEventListener('execution_error', (event) => {
    const job = jobForEvent(event)
    if (!job) return
    const detail = event?.detail || {}
    jobStatus(job, 'error', { message: detail.exception_message || detail.exception_type || 'ComfyUI 执行失败' })
  })
  api.addEventListener('execution_interrupted', (event) => {
    const job = jobForEvent(event)
    if (job) jobStatus(job, 'interrupted', { message: '生成已停止' })
  })
  return true
}

async function queueJob(message) {
  if (typeof message.workflow === 'number') rows('model')[message.workflow]?.doModeChange?.(true)
  applyProfile(message.renderProfile)
  const inputNode = photoshopInputNode()
  if (!workflowState().ready || typeof app()?.queuePrompt !== 'function') {
    send({
      protocolVersion: PS_PROTOCOL,
      clientId,
      psClientId: message.psClientId,
      jobId: message.jobId,
      jobStatus: { phase: 'error', message: '当前页面没有可用的 Photoshop 输入与结果节点' },
    })
    return
  }
  setNodeWidget(inputNode, 'job_id', String(message.inputKey || ''))
  const job = {
    jobId: String(message.jobId || ''),
    psClientId: String(message.psClientId || ''),
    batchIndex: Number(message.batchIndex) || 0,
    promptId: '',
    terminal: false,
  }
  jobs.set(job.jobId, job)
  attachProgressListeners()
  jobStatus(job, 'queued', { progress: 0 })
  try {
    const result = await app().queuePrompt(0, 1)
    if (job.terminal || !jobs.has(job.jobId)) return
    job.promptId = String(result?.prompt_id || result?.promptId || '')
    if (job.promptId) promptJobs.set(job.promptId, job)
    jobStatus(job, 'queued', { progress: 0 })
  } catch (error) {
    console.error('photoshop bridge queue', error)
    jobStatus(job, 'error', { message: error?.message || '排队失败' })
  } finally {
    setNodeWidget(inputNode, 'job_id', '')
  }
}

async function interruptJob(message) {
  const job = jobs.get(String(message.jobId || ''))
  if (!job) return
  try {
    if (job.promptId && currentPromptId && job.promptId !== currentPromptId) {
      await fetch('/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: [job.promptId] }),
      })
    } else if (app()?.api?.interrupt) await app().api.interrupt()
    else await fetch('/interrupt', { method: 'POST' })
    jobStatus(job, 'interrupted', { message: '生成已停止' })
  } catch (error) {
    send({ jobId: job.jobId, alert: error?.message || '无法停止生成' })
  }
}

function publishModels(force = false) {
  const modelRows = rows('model')
  if (!modelRows.length || !socket || socket.readyState !== WebSocket.OPEN) return false
  const state = workflowState()
  const payload = JSON.stringify({
    protocolVersion: PS_PROTOCOL,
    clientId,
    bridgeReady: state.ready,
    workflowFingerprint: state.workflowFingerprint,
    Send_workflow: modelRows.map((widget) => ({ name: rowName(widget), selected: Boolean(widget.toggled) })),
  })
  if (!force && payload === lastModels) return true
  lastModels = payload
  socket.send(payload)
  return true
}

function connectBridge() {
  clearTimeout(reconnectTimer)
  socket = new WebSocket(socketUrl())
  socket.onmessage = (event) => {
    let message
    try { message = JSON.parse(event.data) } catch (_) { return }
    try {
      if (message.photoshopConnected || message.pullModels) publishModels(true)
      if (message.photoshopConnected) send({ pullProfile: true })
      if (message.interrupt) return void interruptJob(message)
      if (message.queue) {
        queueChain = queueChain.catch(() => {}).then(() => queueJob(message))
        return
      }
      if (message.jobAck?.phase === 'completed') {
        const job = jobs.get(String(message.jobId || ''))
        if (job) jobStatus(job, 'completed', { progress: 100 })
        return
      }
      if (typeof message.workflow === 'number') rows('model')[message.workflow]?.doModeChange?.(true)
      applyProfile(message.renderProfile)
    } catch (error) {
      console.error('photoshop bridge', error)
    }
  }
  socket.onopen = () => {
    autoloadPhotoshopWorkflow()
    publishHello()
    publishModels(true)
  }
  socket.onclose = () => {
    jobs.clear()
    promptJobs.clear()
    currentPromptId = ''
    reconnectTimer = window.setTimeout(connectBridge, 4000)
  }
}

window.setInterval(() => publishModels(false), 2000)
window.setInterval(() => autoloadPhotoshopWorkflow(), 3000)
window.setInterval(() => attachProgressListeners(), 1000)
window.setInterval(publishHello, 5000)
attachProgressListeners()
connectBridge()
