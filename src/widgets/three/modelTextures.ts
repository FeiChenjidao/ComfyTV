import * as THREE from 'three'

import { MATERIAL_MAP_KEYS } from '@/widgets/material/types'
import type { ZipEntry } from '@/widgets/storyboard/zipWriter'

const MAP_KEYS = [...MATERIAL_MAP_KEYS, 'bumpMap', 'displacementMap', 'specularMap',
  'clearcoatNormalMap', 'specularIntensityMap', 'specularColorMap', 'sheenColorMap',
  'sheenRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap',
  'thicknessMap', 'lightMap'] as const

export type ExportMaterial = THREE.Material & Partial<THREE.MeshPhysicalMaterial>

export async function texturePng(texture: THREE.Texture, channel?: number): Promise<Uint8Array> {
  const image = texture.image as CanvasImageSource & {
    width: number; height: number; naturalWidth?: number; naturalHeight?: number; data: ArrayLike<number>
  }
  const width = image?.naturalWidth || image?.width
  const height = image?.naturalHeight || image?.height
  if (!width || !height) throw new Error(`Texture "${texture.name}" has no image data`)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Cannot encode model textures: canvas is unavailable')
  if (texture instanceof THREE.DataTexture) {
    if (texture.type !== THREE.UnsignedByteType || texture.format !== THREE.RGBAFormat) {
      throw new Error(`Texture "${texture.name}" must be RGBA8 to export as PNG`)
    }
    const pixels = ctx.createImageData(width, height)
    pixels.data.set(image.data)
    ctx.putImageData(pixels, 0, 0)
  } else {
    ctx.drawImage(image, 0, 0)
  }
  if (channel !== undefined) {
    const pixels = ctx.getImageData(0, 0, width, height)
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = pixels.data[i + channel]
      pixels.data[i + 3] = 255
    }
    ctx.putImageData(pixels, 0, 0)
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (result) => result ? resolve(result) : reject(new Error(`Cannot encode texture "${texture.name}"`)),
    'image/png',
  ))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function collectModelTextures(materials: ExportMaterial[]) {
  const files: ZipEntry[] = []
  const names = new Map<THREE.Texture, { index: number; variants: Map<number | undefined, string> }>()
  const maps = new Map<THREE.Material, Record<string, string>>()
  for (const material of materials) {
    const slots: Record<string, string> = {}
    for (const key of MAP_KEYS) {
      const texture = material[key as keyof ExportMaterial]
      if (!(texture instanceof THREE.Texture)) continue
      // Three.js uses G for roughness and B for metalness; MTL uses grayscale maps.
      const channel = key === 'roughnessMap' ? 1 : key === 'metalnessMap' ? 2 : undefined
      let entry = names.get(texture)
      if (!entry) {
        entry = { index: names.size + 1, variants: new Map() }
        names.set(texture, entry)
      }
      let name = entry.variants.get(channel)
      if (!name) {
        name = `textures/texture_${entry.index}${channel === undefined ? '' : `_${key}`}.png`
        files.push({ name, data: await texturePng(texture, channel) })
        entry.variants.set(channel, name)
      }
      slots[key] = name
    }
    maps.set(material, slots)
  }
  return { files, maps }
}
