import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import type * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

import { downloadBlob } from '@/utils/download'

export const MODEL_EXPORT_FORMATS = ['glb', 'obj', 'stl', 'fbx'] as const
export type ModelExportFormat = typeof MODEL_EXPORT_FORMATS[number]

function outputName(baseName: string, format: ModelExportFormat): string {
  const safe = baseName.trim().replace(/\.[^.]+$/, '') || 'model'
  return `${safe}.${format}`
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

  if (format === 'glb') {
    const result = await new GLTFExporter().parseAsync(root, {
      binary: true,
      animations,
    })
    if (!(result instanceof ArrayBuffer)) throw new Error('GLB exporter returned text data')
    downloadBlob(filename, new Blob([result], { type: 'model/gltf-binary' }))
    return
  }

  if (format === 'obj') {
    const result = new OBJExporter().parse(root)
    downloadBlob(filename, new Blob([result], { type: 'text/plain' }))
    return
  }

  if (format === 'stl') {
    const result = new STLExporter().parse(root, { binary: true })
    downloadBlob(filename, new Blob([result.buffer], { type: 'model/stl' }))
    return
  }

  const result = await new FBXExporter().parseAsync(root, { animations })
  const bytes = result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  ) as ArrayBuffer
  downloadBlob(filename, new Blob([bytes], { type: 'application/octet-stream' }))
}
