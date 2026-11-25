import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

import { downloadBlob } from '@/utils/download'
import { buildZip, type ZipEntry } from '@/widgets/storyboard/zipWriter'
import { collectModelTextures, type ExportMaterial } from './modelTextures'

export const MODEL_EXPORT_FORMATS = ['glb', 'obj', 'stl', 'fbx'] as const
export type ModelExportFormat = typeof MODEL_EXPORT_FORMATS[number]

function outputName(baseName: string, format: ModelExportFormat): string {
  const safe = baseName.trim().replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'model'
  return `${safe}.${format}`
}

function modelMaterials(root: THREE.Object3D): ExportMaterial[] {
  const materials = new Set<ExportMaterial>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
    }
  })
  return [...materials]
}

function objBundle(root: THREE.Object3D, materials: ExportMaterial[], maps: Map<THREE.Material, Record<string, string>>, name: string): ZipEntry[] {
  const names = new Map(materials.map((material, i) => [material, `Material_${i + 1}`]))
  const scene = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const exportMaterials: THREE.Material[] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry
    const groups = Array.isArray(object.material) ? geometry.groups : [
      { start: 0, count: geometry.index?.count ?? geometry.getAttribute('position').count, materialIndex: 0 },
    ]
    for (const group of groups) {
      const material: ExportMaterial = Array.isArray(object.material) ? object.material[group.materialIndex ?? 0] : object.material
      if (!material) continue
      const part = geometry.clone()
      const end = Math.min(group.start + group.count, geometry.drawRange.start + geometry.drawRange.count)
      const start = Math.max(group.start, geometry.drawRange.start)
      if (end <= start) { part.dispose(); continue }
      part.setIndex(Array.from({ length: end - start }, (_, i) => geometry.index?.getX(start + i) ?? start + i))
      const uv = part.getAttribute('uv')
      const texture = material.map ?? material.normalMap ?? material.roughnessMap ?? material.metalnessMap
      if (uv && texture?.flipY === false) {
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
      }
      const exportedMaterial = material.clone()
      exportedMaterial.name = names.get(material)!
      const mesh = new THREE.Mesh(part, exportedMaterial)
      mesh.name = object.name
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(object.matrixWorld)
      scene.add(mesh)
      geometries.push(part)
      exportMaterials.push(exportedMaterial)
    }
  })
  const mtl = materials.map((material) => {
    const color = (material.color ?? new THREE.Color(1, 1, 1)).clone().convertLinearToSRGB()
    const emissive = (material.emissive ?? new THREE.Color(0, 0, 0)).clone().multiplyScalar(material.emissiveIntensity ?? 1)
    const lines = [`newmtl ${names.get(material)}`, `Kd ${color.r} ${color.g} ${color.b}`,
      `Ke ${emissive.r} ${emissive.g} ${emissive.b}`, `d ${material.opacity}`,
      `Pm ${material.metalness ?? 0}`, `Pr ${material.roughness ?? 1}`, 'illum 2']
    const directives: Record<string, string> = { map: 'map_Kd', normalMap: 'norm', bumpMap: 'map_Bump',
      emissiveMap: 'map_Ke', alphaMap: 'map_d', metalnessMap: 'map_Pm', roughnessMap: 'map_Pr',
      specularMap: 'map_Ks', displacementMap: 'disp' }
    for (const [slot, file] of Object.entries(maps.get(material) ?? {})) {
      if (directives[slot]) lines.push(`${directives[slot]} ${file}`)
    }
    return lines.join('\n')
  }).join('\n\n')
  try {
    scene.updateMatrixWorld(true)
    const obj = `mtllib ${name}.mtl\n${new OBJExporter().parse(scene)}`
    const encode = new TextEncoder()
    return [{ name: `${name}.obj`, data: encode.encode(obj) }, { name: `${name}.mtl`, data: encode.encode(mtl) }]
  } finally {
    geometries.forEach((geometry) => geometry.dispose())
    exportMaterials.forEach((material) => material.dispose())
  }
}

function animationClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const clips = new Map<string, THREE.AnimationClip>()
  root.traverse((object) => {
    for (const clip of object.animations ?? []) clips.set(clip.uuid, clip)
  })
  return [...clips.values()]
}

export async function exportModelObject(
  root: THREE.Object3D,
  format: ModelExportFormat,
  baseName = 'model',
): Promise<void> {
  let meshCount = 0
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1
  })
  if (!meshCount) throw new Error('The selected model has no exportable mesh')

  root.updateMatrixWorld(true)
  const filename = outputName(baseName, format)
  const animations = animationClips(root)
  const materials = modelMaterials(root)
  const { files, maps } = await collectModelTextures(materials)
  const stem = filename.slice(0, -(format.length + 1))
  let modelFiles: ZipEntry[]

  if (format === 'glb') {
    const result = await new GLTFExporter().parseAsync(root, {
      binary: true,
      animations,
    })
    if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned text data')
    modelFiles = [{ name: filename, data: new Uint8Array(result) }]
  } else if (format === 'obj') {
    modelFiles = objBundle(root, materials, maps, stem)
  } else if (format === 'stl') {
    const result = new STLExporter().parse(root, { binary: true })
    modelFiles = [{ name: filename, data: new Uint8Array(result.buffer) }]
  } else {
    const result = await new FBXExporter().parseAsync(root, { animations, embedTextures: true })
    modelFiles = [{ name: filename, data: new Uint8Array(result) }]
  }
  if (files.length) {
    const manifest = materials.map((material, i) => ({
      material: `Material_${i + 1}`, name: material.name, maps: maps.get(material),
      color: material.color?.toArray(), metalness: material.metalness, roughness: material.roughness,
    }))
    files.push({ name: 'materials.json', data: new TextEncoder().encode(JSON.stringify({
      note: format === 'stl' ? 'STL stores geometry only; textures are included separately. STL has no UV coordinates.' : undefined,
      materials: manifest,
    }, null, 2)) })
  }
  if (format === 'obj' || files.length) {
    const zip = buildZip([...modelFiles, ...files])
    downloadBlob(`${stem}_${format}.zip`, new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  } else {
    const type = format === 'glb' ? 'model/gltf-binary' : format === 'stl' ? 'model/stl' : 'application/octet-stream'
    downloadBlob(filename, new Blob([modelFiles[0].data as Uint8Array<ArrayBuffer>], { type }))
  }
}
