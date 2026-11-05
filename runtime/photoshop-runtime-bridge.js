const PS_PROTOCOL = 3
const PS_NODE = '🔹Photoshop ComfyUI Plugin'
const SEND_NODE = '🔹SendTo Photoshop Plugin'
const clientId = globalThis.crypto?.randomUUID?.() || String(Date.now())
const preferredPsClientId = new URLSearchParams(location.search).get('comfytv_ps_client') || ''
let socket = null
let reconnectTimer = 0
let lastModels = ''
let listenersReady = false
let activeJob = null

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
    ready: types.includes(PS_NODE) && types.includes(SEND_NODE),
    workflowFingerprint: (hash >>> 0).toString(16).padStart(8, '0'),
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

function applyProfile(profile) {
  if (!profile?.group) return
  rows('mode').find((widget) => rowName(widget) === profile.group)?.doModeChange?.(true)
  app()?.graph?.setDirtyCanvas?.(true, true)
}

function jobStatus(phase, extra = {}) {
  const job = activeJob
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
  if (job.terminal) activeJob = null
}

function eventPromptId(event) {
  return String(event?.detail?.prompt_id || '')
}

function matchesJob(event) {
  if (!activeJob || activeJob.terminal) return false
  const promptId = eventPromptId(event)
  return !activeJob.promptId || !promptId || promptId === activeJob.promptId
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
    if (!activeJob || activeJob.terminal) return
    activeJob.promptId = eventPromptId(event) || activeJob.promptId
    jobStatus('running', { progress: 0 })
  })
  api.addEventListener('progress', (event) => {
    if (!matchesJob(event)) return
    const value = Number(event?.detail?.value)
    const max = Number(event?.detail?.max)
    if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
      jobStatus('running', { progress: Math.max(0, Math.min(99, Math.round(value / max * 100))) })
    }
  })
  api.addEventListener('progress_state', (event) => {
    if (!matchesJob(event)) return
    const progress = aggregateProgress(event?.detail)
    if (progress > 0) jobStatus('running', { progress })
  })
  api.addEventListener('execution_success', (event) => {
    if (matchesJob(event)) jobStatus('running', { progress: 99, message: '执行完成，等待 Photoshop 接收结果' })
  })
  api.addEventListener('execution_error', (event) => {
    if (!matchesJob(event)) return
    const detail = event?.detail || {}
    jobStatus('error', { message: detail.exception_message || detail.exception_type || 'ComfyUI 执行失败' })
  })
  api.addEventListener('execution_interrupted', (event) => {
    if (matchesJob(event)) jobStatus('interrupted', { message: '生成已停止' })
  })
  return true
}

async function queueJob(message) {
  if (activeJob && !activeJob.terminal) {
    send({ jobId: message.jobId, alert: '已有 Photoshop 任务正在运行' })
    return
  }
  if (typeof message.workflow === 'number') rows('model')[message.workflow]?.doModeChange?.(true)
  applyProfile(message.renderProfile)
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
  activeJob = {
    jobId: String(message.jobId || ''),
    psClientId: String(message.psClientId || ''),
    batchIndex: Number(message.batchIndex) || 0,
    promptId: '',
    terminal: false,
  }
  attachProgressListeners()
  jobStatus('queued', { progress: 0 })
  try {
    const result = await app().queuePrompt(0, 1)
    if (!activeJob) return
    activeJob.promptId = String(result?.prompt_id || result?.promptId || '')
    jobStatus('queued', { progress: 0 })
  } catch (error) {
    console.error('photoshop bridge queue', error)
    jobStatus('error', { message: error?.message || '排队失败' })
  }
}

async function interruptJob(message) {
  if (!activeJob || (message.jobId && message.jobId !== activeJob.jobId)) return
  try {
    if (app()?.api?.interrupt) await app().api.interrupt()
    else await fetch('/interrupt', { method: 'POST' })
    jobStatus('interrupted', { message: '生成已停止' })
  } catch (error) {
    send({ jobId: activeJob?.jobId || '', alert: error?.message || '无法停止生成' })
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
      if (message.queue) return void queueJob(message)
      if (message.jobAck?.phase === 'completed' && activeJob?.jobId === message.jobId) {
        jobStatus('completed', { progress: 100 })
        return
      }
      if (typeof message.workflow === 'number') rows('model')[message.workflow]?.doModeChange?.(true)
      applyProfile(message.renderProfile)
    } catch (error) {
      console.error('photoshop bridge', error)
    }
  }
  socket.onopen = () => {
    publishHello()
    publishModels(true)
  }
  socket.onclose = () => {
    activeJob = null
    reconnectTimer = window.setTimeout(connectBridge, 4000)
  }
}

window.setInterval(() => publishModels(false), 2000)
window.setInterval(() => attachProgressListeners(), 1000)
window.setInterval(publishHello, 5000)
attachProgressListeners()
connectBridge()
