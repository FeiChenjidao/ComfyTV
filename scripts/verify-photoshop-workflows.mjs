import fs from 'node:fs'
import path from 'node:path'

const NODE_TYPE = '🔹Photoshop ComfyUI Plugin'
const EXPECTED_OUTPUTS = [
  'Canvas', 'Mask', 'Ref1', 'Ref2', 'Ref3', 'Ref4', 'Ref5', 'Ref6',
  'Media Batch', 'Has Mask', 'Seed', '+', '-', 'W', 'H',
  '比例', '质量', '分辨率', '输出背景', '尺寸',
]

function verify(file) {
  const workflow = JSON.parse(fs.readFileSync(file, 'utf8'))
  const nodes = new Map((workflow.nodes || []).map((node) => [node.id, node]))
  const links = workflow.links || []
  const ids = new Set()
  for (const link of links) {
    if (!Array.isArray(link) || link.length < 6) throw new Error(`${file}: invalid link record`)
    if (ids.has(link[0])) throw new Error(`${file}: duplicate link id ${link[0]}`)
    ids.add(link[0])
    const source = nodes.get(link[1])
    const target = nodes.get(link[3])
    if (!source || !target) throw new Error(`${file}: dangling link ${link[0]}`)
    if (link[2] < 0 || link[2] >= (source.outputs || []).length) {
      throw new Error(`${file}: invalid source slot on link ${link[0]}`)
    }
    if (link[4] < 0 || link[4] >= (target.inputs || []).length) {
      throw new Error(`${file}: invalid target slot on link ${link[0]}`)
    }
  }
  const photoshopNodes = [...nodes.values()].filter((node) => node.type === NODE_TYPE)
  if (photoshopNodes.length !== 1) throw new Error(`${file}: expected one Photoshop node`)
  const names = (photoshopNodes[0].outputs || []).map((output) => output.name)
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_OUTPUTS)) {
    throw new Error(`${file}: Photoshop output contract does not match V3`)
  }
  const photoshop = photoshopNodes[0]
  const linksById = new Map(links.map((link) => [link[0], link]))
  for (const node of nodes.values()) {
    const inputs = node.inputs || []
    const customInputs = [
      ['model.custom_width', 'W'],
      ['model.custom_height', 'H'],
    ]
    if (!customInputs.every(([inputName]) => inputs.some((input) => input.name === inputName))) continue
    for (const [inputName, outputName] of customInputs) {
      const inputSlot = inputs.findIndex((input) => input.name === inputName)
      const sourceSlot = names.indexOf(outputName)
      const link = linksById.get(inputs[inputSlot].link)
      if (!link || link[1] !== photoshop.id || link[2] !== sourceSlot || link[3] !== node.id || link[4] !== inputSlot) {
        throw new Error(`${file}: ${node.title || node.type} ${inputName} is not connected to Photoshop ${outputName}`)
      }
    }
  }
  console.log(`ok ${path.resolve(file)} (${nodes.size} nodes, ${links.length} links)`)
}

for (const file of process.argv.slice(2)) verify(file)
