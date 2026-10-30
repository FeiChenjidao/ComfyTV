const clientId = (globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) || String(Date.now())
let socket
let lastModelPayload = ""

function comfyApp() {
  return window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app
}

function socketUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${location.host}/ps/ws?platform=cm&clientId=${clientId}`
}

function graphNodes() {
  const app = comfyApp()
  const graph = app && app.graph
  if (!graph) return []
  if (Array.isArray(graph._nodes) && graph._nodes.length) return graph._nodes
  if (Array.isArray(graph.nodes)) return graph.nodes
  return []
}

function nodeType(node) {
  return node.comfyClass || node.type || ""
}

function findMuter(kind) {
  return graphNodes().find((node) => {
    if (nodeType(node) !== "Fast Groups Muter (rgthree)") return false
    const match = String((node.properties && node.properties.matchTitle) || "")
    const title = String(node.title || "")
    if (kind === "model") return match.includes("^(NanoBanana") || title.includes("工作流")
    return match.includes("NanoBanana 1K") || title.includes("模式")
  })
}

function rowName(widget) {
  const label = String(widget.label || "")
  if (label.startsWith("Enable ")) return label.slice("Enable ".length)
  const name = String(widget.name || "").replace(/^Enable /, "")
  if (!name || name === "RGTHREE_TOGGLE_AND_NAV") return ""
  return name
}

function muterRows(muter) {
  if (!muter) return []
  return (muter.widgets || []).filter((widget) => typeof widget.doModeChange === "function" && rowName(widget))
}

function enableGroup(group) {
  const widget = muterRows(findMuter("mode")).find((item) => rowName(item) === group)
  if (widget) widget.doModeChange(true)
}

function applyRenderProfile(profile) {
  const app = comfyApp()
  if (!profile || !profile.group || !app) return
  enableGroup(profile.group)
  if (app.graph) app.graph.setDirtyCanvas(true, true)
}

function notify(text) {
  if (!socket || socket.readyState !== 1) return
  socket.send(JSON.stringify({ alert: text }))
}

function graphLink(id) {
  const app = comfyApp()
  const links = app && app.graph && app.graph.links
  if (!links || id == null) return null
  if (typeof links.get === "function") return links.get(id) || null
  return links[id] || null
}

function linkOrigin(link) {
  if (!link) return null
  if (link.origin_id != null) return { id: link.origin_id, slot: link.origin_slot }
  if (Array.isArray(link)) return { id: link[1], slot: link[2] }
  return null
}

function photoshopNode() {
  return graphNodes().find((node) => nodeType(node).includes("Photoshop ComfyUI Plugin"))
}

function inputIndex(node, name) {
  return (node.inputs || []).findIndex((input) => input.name === name)
}

function ensureInput(node, name) {
  const existing = inputIndex(node, name)
  if (existing >= 0) return existing
  if (typeof node.addInput !== "function") return -1
  node.addInput(name, "IMAGE")
  return inputIndex(node, name)
}

function refSlots(node) {
  const outputs = node.outputs || []
  const slots = []
  for (let index = 1; index <= 6; index += 1) {
    const slot = outputs.findIndex((output) => {
      const name = String((output && (output.name || output.label || output.localized_name)) || "")
      return name === `Ref${index}`
    })
    if (slot >= 0) slots.push(slot)
  }
  if (slots.length) return slots
  if (outputs.length >= 13) return [7, 8, 9, 10, 11, 12]
  return []
}

function removeManaged() {
  const app = comfyApp()
  if (!app || !app.graph || typeof app.graph.remove !== "function") return
  graphNodes().filter((node) => node.properties && node.properties.comfytvManaged === "ref-batch").forEach((node) => {
    try { app.graph.remove(node) } catch (_) {}
  })
}

function connectSlot(origin, originSlot, target, targetSlot) {
  if (!origin || !target || originSlot < 0 || targetSlot < 0) return false
  const input = (target.inputs || [])[targetSlot]
  if (!input) return false
  const current = input.link != null ? linkOrigin(graphLink(input.link)) : null
  if (current && current.id === origin.id && current.slot === originSlot) return true
  if (input.link != null && typeof target.disconnectInput === "function") target.disconnectInput(targetSlot)
  if (typeof origin.connect !== "function") return false
  origin.connect(originSlot, target, targetSlot)
  return true
}

function disconnectRefLink(target, targetSlot, ps, slots) {
  const input = (target.inputs || [])[targetSlot]
  if (!input || input.link == null) return
  const origin = linkOrigin(graphLink(input.link))
  if (!origin || !ps || origin.id !== ps.id || slots.indexOf(origin.slot) < 0) return
  if (typeof target.disconnectInput === "function") target.disconnectInput(targetSlot)
}

function makeBatch() {
  const app = comfyApp()
  const LiteGraph = window.LiteGraph
  if (!app || !app.graph || !LiteGraph || typeof LiteGraph.createNode !== "function") return null
  const node = LiteGraph.createNode("BatchImagesNode")
  if (!node) return null
  node.properties = node.properties || {}
  node.properties.comfytvManaged = "ref-batch"
  node.title = "PS 参考图"
  app.graph.add(node)
  return node
}

function batchInputName(node, index) {
  const sample = (node.inputs || []).map((input) => input.name).find((name) => /\d+$/.test(String(name || "")))
  if (sample) return String(sample).replace(/\d+$/, String(index))
  return `images.image${index}`
}

function wireAutogrow(ps, slots, count) {
  graphNodes().filter((node) => nodeType(node) === "GeminiNanoBanana2V2" || nodeType(node) === "OpenAIGPTImageNodeV2").forEach((node) => {
    for (let index = 0; index < 6; index += 1) {
      const name = `model.images.image_${index + 3}`
      let slot = inputIndex(node, name)
      if (index < count) {
        if (slot < 0) slot = ensureInput(node, name)
        if (slot >= 0) connectSlot(ps, slots[index], node, slot)
      } else if (slot >= 0) {
        disconnectRefLink(node, slot, ps, slots)
      }
    }
  })
}

function wirePro(ps, slots, count) {
  graphNodes().filter((node) => nodeType(node) === "GeminiImage2Node").forEach((node) => {
    const images = inputIndex(node, "images")
    if (images < 0) return
    if (count <= 0) {
      connectSlot(ps, 0, node, images)
      return
    }
    const batch = makeBatch()
    if (!batch) {
      connectSlot(ps, 0, node, images)
      return
    }
    connectSlot(ps, 0, batch, ensureInput(batch, batchInputName(batch, 0)))
    for (let index = 0; index < count; index += 1) {
      connectSlot(ps, slots[index], batch, ensureInput(batch, batchInputName(batch, index + 1)))
    }
    connectSlot(batch, 0, node, images)
  })
}

function wireReferences(count) {
  removeManaged()
  const ps = photoshopNode()
  if (!ps) return
  const slots = refSlots(ps)
  const usable = Math.max(0, Math.min(count, slots.length))
  if (count > 0 && usable < count) notify("参考图输出口还没出现。请完全重启 ComfyUI，再重新打开工作流。")
  wireAutogrow(ps, slots, usable)
  wirePro(ps, slots, usable)
  const app = comfyApp()
  if (app && app.graph) app.graph.setDirtyCanvas(true, true)
}

async function attachAndQueue(message) {
  if (typeof message.workflow === "number") {
    const widget = muterRows(findMuter("model"))[message.workflow]
    if (widget) widget.doModeChange(true)
  }
  if (message.renderProfile && message.renderProfile.group) applyRenderProfile(message.renderProfile)
  wireReferences(Number(message.referenceCount) || 0)
  const app = comfyApp()
  if (!app || typeof app.queuePrompt !== "function") {
    notify("ComfyUI 页面还不能排队，请确认工作流已打开")
    return
  }
  try {
    await app.queuePrompt(0, 1)
  } catch (error) {
    console.error("photoshop bridge queue", error)
    notify((error && error.message) || "排队失败")
  }
}

async function interruptJob() {
  const app = comfyApp()
  try {
    if (app && app.api && typeof app.api.interrupt === "function") {
      await app.api.interrupt()
      return
    }
    await fetch("/interrupt", { method: "POST" })
  } catch (error) {
    notify((error && error.message) || "无法停止生成")
  }
}

function publishModels(force) {
  const rows = muterRows(findMuter("model"))
  if (!rows.length || !socket || socket.readyState !== 1) return false
  const payload = JSON.stringify({
    Send_workflow: rows.map((widget) => ({
      name: rowName(widget),
      selected: Boolean(widget.toggled),
    })),
  })
  if (!force && payload === lastModelPayload) return true
  lastModelPayload = payload
  socket.send(payload)
  return true
}

function connectBridge() {
  socket = new WebSocket(socketUrl())
  socket.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch (_) {
      return
    }
    try {
      if (message.photoshopConnected || message.pullModels) publishModels(true)
      if (message.photoshopConnected) socket.send(JSON.stringify({ pullProfile: true }))
      if (message.interrupt) {
        interruptJob()
        return
      }
      if (message.queue) {
        attachAndQueue(message)
        return
      }
      if (typeof message.workflow === "number") {
        const widget = muterRows(findMuter("model"))[message.workflow]
        if (widget) widget.doModeChange(true)
      }
      if (message.renderProfile) applyRenderProfile(message.renderProfile)
    } catch (error) {
      console.error("photoshop bridge", error)
    }
  }
  socket.onopen = () => {
    publishModels(true)
  }
  socket.onclose = () => {
    setTimeout(connectBridge, 4000)
  }
}

setInterval(() => publishModels(false), 2000)
connectBridge()
