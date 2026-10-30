import { app } from "../../../scripts/app.js"

const OUTPUTS = [
  ["Canvas", "IMAGE"],
  ["Mask", "MASK"],
  ["Seed", "INT"],
  ["+", "STRING"],
  ["-", "STRING"],
  ["W", "INT"],
  ["H", "INT"],
  ["Ref1", "IMAGE"],
  ["Ref2", "IMAGE"],
  ["Ref3", "IMAGE"],
  ["Ref4", "IMAGE"],
  ["Ref5", "IMAGE"],
  ["Ref6", "IMAGE"],
  ["比例", "COMBO"],
  ["质量", "COMBO"],
  ["分辨率", "COMBO"],
  ["输出背景", "COMBO"],
  ["尺寸", "COMBO"],
]

const WIRING = {
  GeminiNanoBanana2V2: {
    "model.aspect_ratio": "比例",
    "model.resolution": "分辨率",
    "model.thinking_level": "质量",
  },
  GeminiImage2Node: {
    aspect_ratio: "比例",
    resolution: "分辨率",
  },
  OpenAIGPTImageNodeV2: {
    "model.size": "尺寸",
    "model.background": "输出背景",
    "model.quality": "质量",
  },
}

function nodeType(node) {
  return node.comfyClass || node.type || ""
}

const COMBO_NAMES = new Set(["比例", "质量", "分辨率", "输出背景", "尺寸"])

function markComboLinks(node) {
  if (!node.graph) return
  eachLink(node.graph, (link) => {
    if (originId(link) !== node.id) return
    const slot = link.origin_slot != null ? link.origin_slot : (Array.isArray(link) ? link[2] : null)
    const output = (node.outputs || [])[slot]
    if (!output || !COMBO_NAMES.has(output.name)) return
    if (link.type != null) link.type = "COMBO"
    else if (Array.isArray(link)) link[5] = "COMBO"
  })
}

function sameOutputs(node) {
  const outputs = node.outputs || []
  return outputs.length === OUTPUTS.length && OUTPUTS.every((item, index) => outputs[index] && outputs[index].name === item[0])
}

function linkId(link) {
  return link.id != null ? link.id : link[0]
}

function originId(link) {
  if (link.origin_id != null) return link.origin_id
  if (Array.isArray(link)) return link[1]
  return null
}

function setOriginSlot(link, slot) {
  if (link.origin_slot != null) link.origin_slot = slot
  else if (Array.isArray(link)) link[2] = slot
}

function eachLink(graph, visit) {
  const links = graph.links
  if (!links) return
  const list = typeof links.values === "function" ? links.values() : links
  for (const link of list) {
    if (link) visit(link)
  }
}

function wire(node) {
  const graph = node.graph
  if (!graph) return
  const nodes = graph._nodes || graph.nodes || []
  const slotOf = new Map((node.outputs || []).map((output, index) => [output.name, index]))
  nodes.forEach((target) => {
    const mapping = WIRING[nodeType(target)]
    if (!mapping || typeof node.connect !== "function") return
    ;(target.inputs || []).forEach((input, index) => {
      const originName = mapping[input.name]
      if (!originName || input.link != null) return
      const slot = slotOf.get(originName)
      if (slot == null) return
      try {
        node.connect(slot, target, index)
      } catch (_) {}
    })
  })
}

function fixNode(node) {
  if (sameOutputs(node)) {
    markComboLinks(node)
    wire(node)
    return
  }
  const linksByName = new Map()
  const nameByLink = new Map()
  ;(node.outputs || []).forEach((output) => {
    const ids = output.links || []
    if (ids.length) linksByName.set(output.name, ids.slice())
    ids.forEach((id) => nameByLink.set(id, output.name))
  })
  node.outputs = OUTPUTS.map(([name, type]) => ({
    name,
    localized_name: name,
    type,
    links: linksByName.get(name) || null,
  }))
  const slotOf = new Map(OUTPUTS.map(([name], index) => [name, index]))
  if (node.graph) {
    eachLink(node.graph, (link) => {
      if (originId(link) !== node.id) return
      const slot = slotOf.get(nameByLink.get(linkId(link)))
      if (slot == null) return
      setOriginSlot(link, slot)
    })
  }
  const width = Math.max((node.size && node.size[0]) || 330, 330)
  const height = Math.max((node.size && node.size[1]) || 0, 60 + OUTPUTS.length * 22)
  if (typeof node.setSize === "function") node.setSize([width, height])
  else node.size = [width, height]
  markComboLinks(node)
  if (typeof node.setDirtyCanvas === "function") node.setDirtyCanvas(true, true)
  wire(node)
}

function fixGraph(graph) {
  if (!graph) return
  const nodes = graph._nodes || graph.nodes || []
  nodes.forEach((node) => {
    if (nodeType(node).includes("Photoshop ComfyUI Plugin")) fixNode(node)
  })
}

app.registerExtension({
  name: "comfytv.photoshop.outputs",
  async setup() {
    const wrap = (graph) => {
      if (!graph || graph.__comfytvPsOutputs || typeof graph.configure !== "function") return
      graph.__comfytvPsOutputs = true
      const configure = graph.configure
      graph.configure = function () {
        const result = configure.apply(this, arguments)
        fixGraph(this)
        return result
      }
    }
    const tick = () => {
      try {
        wrap(app.graph)
        fixGraph(app.graph)
      } catch (_) {}
    }
    tick()
    setInterval(tick, 1500)
  },
})
