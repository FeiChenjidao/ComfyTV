import fs from 'node:fs'
import path from 'node:path'

const NODE_TYPE = '🔹Photoshop ComfyUI Plugin'
const OUTPUTS = [
  ['Canvas', 'IMAGE'],
  ['Mask', 'IMAGE'],
  ['Ref1', 'IMAGE'],
  ['Ref2', 'IMAGE'],
  ['Ref3', 'IMAGE'],
  ['Ref4', 'IMAGE'],
  ['Ref5', 'IMAGE'],
  ['Ref6', 'IMAGE'],
  ['Media Batch', 'IMAGE'],
  ['Has Mask', 'BOOLEAN'],
  ['Seed', 'INT'],
  ['+', 'STRING'],
  ['-', 'STRING'],
  ['W', 'INT'],
  ['H', 'INT'],
  ['比例', 'COMBO'],
  ['质量', 'COMBO'],
  ['分辨率', 'COMBO'],
  ['输出背景', 'COMBO'],
  ['尺寸', 'COMBO'],
]

const ALIASES = new Map([
  ['AI Canvas', 'Canvas'],
  ['AI Mask', 'Mask'],
  ['AI Ref1', 'Ref1'],
  ['AI Ref2', 'Ref2'],
  ['AI Ref3', 'Ref3'],
  ['AI Ref4', 'Ref4'],
  ['AI Ref5', 'Ref5'],
  ['AI Ref6', 'Ref6'],
  ['AI Media Batch', 'Media Batch'],
])

function migrate(file) {
  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'))
  const nodes = (workflow.nodes || []).filter((node) => node.type === NODE_TYPE)
  if (!nodes.length) return { file, changed: false, nodes: 0 }

  for (const node of nodes) {
    const oldOutputs = Array.isArray(node.outputs) ? node.outputs : []
    const oldNames = oldOutputs.map((output) => ALIASES.get(output.name) || output.name)
    const outputIndex = new Map(OUTPUTS.map(([name], index) => [name, index]))
    const linksByOutput = Array.from({ length: OUTPUTS.length }, () => [])

    for (const link of workflow.links || []) {
      if (link[1] !== node.id) continue
      const oldName = oldNames[link[2]]
      const nextIndex = outputIndex.get(oldName)
      if (nextIndex === undefined) {
        throw new Error(`${file}: unsupported Photoshop output ${String(oldName)}`)
      }
      link[2] = nextIndex
      link[5] = OUTPUTS[nextIndex][1]
      linksByOutput[nextIndex].push(link[0])
    }

    node.outputs = OUTPUTS.map(([name, type], index) => ({
      name,
      type,
      links: linksByOutput[index].length ? linksByOutput[index] : null,
      slot_index: index,
    }))
  }

  let nextLinkId = Math.max(Number(workflow.last_link_id) || 0, 0,
    ...(workflow.links || []).map((link) => Number(link[0]) || 0))
  const photoshop = nodes[0]
  const outputIndex = new Map((photoshop.outputs || []).map((output, index) => [output.name, index]))
  const ensureLink = (target, inputName, outputName) => {
    const inputSlot = (target.inputs || []).findIndex((input) => input.name === inputName)
    const sourceSlot = outputIndex.get(outputName)
    if (inputSlot < 0 || sourceSlot === undefined || target.inputs[inputSlot].link != null) return
    const linkId = ++nextLinkId
    workflow.links.push([linkId, photoshop.id, sourceSlot, target.id, inputSlot, 'INT'])
    target.inputs[inputSlot].link = linkId
    if (!Array.isArray(photoshop.outputs[sourceSlot].links)) photoshop.outputs[sourceSlot].links = []
    photoshop.outputs[sourceSlot].links.push(linkId)
  }
  for (const target of workflow.nodes || []) {
    const names = new Set((target.inputs || []).map((input) => input.name))
    if (!names.has('model.custom_width') || !names.has('model.custom_height')) continue
    ensureLink(target, 'model.custom_width', 'W')
    ensureLink(target, 'model.custom_height', 'H')
  }
  workflow.last_link_id = nextLinkId

  fs.writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8')
  return { file, changed: true, nodes: nodes.length }
}

const files = process.argv.slice(2).map((file) => path.resolve(file))
if (!files.length) {
  console.error('Usage: node scripts/migrate-photoshop-workflow.mjs <workflow.json> [...]')
  process.exit(2)
}

for (const file of files) {
  const result = migrate(file)
  console.log(`${result.changed ? 'migrated' : 'skipped'} ${result.file} (${result.nodes} node)`)
}
