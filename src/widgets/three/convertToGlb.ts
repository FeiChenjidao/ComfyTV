import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export const CONVERTIBLE_MODEL_EXTENSIONS = ['.fbx', '.obj', '.stl', '.dae'] as const
export const MODEL_RESOURCE_EXTENSIONS = [
  '.mtl',
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tga',
  '.tif',
  '.tiff',
  '.webp',
] as const

const RESOURCE_LOAD_TIMEOUT_MS = 10_000

export function isConvertibleModelFile(name: string): boolean {
  const lower = name.toLowerCase()
  return CONVERTIBLE_MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function isModelResourceFile(name: string): boolean {
  const lower = name.toLowerCase()
  return MODEL_RESOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function baseNameNoExt(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const base = slash >= 0 ? name.slice(slash + 1) : name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function normalizedResourcePath(value: string): string {
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Keep malformed paths usable by falling back to their literal value.
  }
  return decoded
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^file:\/\//i, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase()
}

function resourceKeys(value: string): string[] {
  const normalized = normalizedResourcePath(value)
  const slash = normalized.lastIndexOf('/')
  const basename = slash >= 0 ? normalized.slice(slash + 1) : normalized
  return basename && basename !== normalized ? [normalized, basename] : [normalized]
}

function createResourceManager(resources: File[]) {
  const manager = new THREE.LoadingManager()
  const filesByPath = new Map<string, File>()
  const objectUrls = new Map<File, string>()
  const idleWaiters = new Set<() => void>()
  let pending = 0

  for (const file of resources) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    for (const key of resourceKeys(relativePath || file.name)) filesByPath.set(key, file)
    for (const key of resourceKeys(file.name)) filesByPath.set(key, file)
  }

  const originalItemStart = manager.itemStart.bind(manager)
  const originalItemEnd = manager.itemEnd.bind(manager)
  manager.itemStart = (url: string) => {
    pending += 1
    originalItemStart(url)
  }
  manager.itemEnd = (url: string) => {
    originalItemEnd(url)
    pending = Math.max(0, pending - 1)
    if (pending === 0) {
      for (const resolve of idleWaiters) resolve()
      idleWaiters.clear()
    }
  }

  manager.setURLModifier((url) => {
    if (/^(?:blob:|data:)/i.test(url)) return url
    const file = resourceKeys(url).map((key) => filesByPath.get(key)).find(Boolean)
    if (!file) return url
    let objectUrl = objectUrls.get(file)
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file)
      objectUrls.set(file, objectUrl)
    }
    return objectUrl
  })

  return {
    manager,
    async waitForLoads(): Promise<void> {
      await Promise.resolve()
      if (pending === 0) return
      await new Promise<void>((resolve) => {
        const done = () => {
          globalThis.clearTimeout(timeout)
          idleWaiters.delete(done)
          resolve()
        }
        const timeout = globalThis.setTimeout(done, RESOURCE_LOAD_TIMEOUT_MS)
        idleWaiters.add(done)
      })
    },
    dispose(): void {
      for (const objectUrl of objectUrls.values()) URL.revokeObjectURL(objectUrl)
      objectUrls.clear()
    },
  }
}

function referencedMtlNames(objText: string): string[] {
  return objText
    .split(/\r?\n/)
    .map((line) => /^\s*mtllib\s+(.+?)\s*$/i.exec(line)?.[1] ?? '')
    .filter(Boolean)
}

function matchingMtlFiles(objFile: File, objText: string, resources: File[]): File[] {
  const mtlFiles = resources.filter((file) => file.name.toLowerCase().endsWith('.mtl'))
  if (mtlFiles.length <= 1) return mtlFiles

  const referenced = new Set(referencedMtlNames(objText).flatMap(resourceKeys))
  const matches = mtlFiles.filter((file) => resourceKeys(file.name).some((key) => referenced.has(key)))
  if (matches.length) return matches

  const expectedName = `${baseNameNoExt(objFile.name).toLowerCase()}.mtl`
  return mtlFiles.filter((file) => file.name.toLowerCase() === expectedName)
}

async function parseToObject(
  file: File,
  resources: File[],
  manager: THREE.LoadingManager,
): Promise<THREE.Object3D> {
  const lower = file.name.toLowerCase()
  if (resources.some((resource) => resource.name.toLowerCase().endsWith('.tga'))) {
    const { TGALoader } = await import('three/examples/jsm/loaders/TGALoader.js')
    manager.addHandler(/\.tga$/i, new TGALoader(manager))
  }

  if (lower.endsWith('.fbx')) {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
    return new FBXLoader(manager).parse(await file.arrayBuffer(), '')
  }
  if (lower.endsWith('.obj')) {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    const text = await file.text()
    const loader = new OBJLoader(manager)
    const mtlFiles = matchingMtlFiles(file, text, resources)
    if (mtlFiles.length) {
      const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js')
      const mtlText = (await Promise.all(mtlFiles.map((mtl) => mtl.text()))).join('\n')
      const materials = new MTLLoader(manager).parse(mtlText, '')
      materials.preload()
      loader.setMaterials(materials)
    }
    return loader.parse(text)
  }
  if (lower.endsWith('.stl')) {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    const geometry = new STLLoader().parse(await file.arrayBuffer())
    const material = new THREE.MeshStandardMaterial({ color: 0xcccccc })
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geometry, material))
    return group
  }
  if (lower.endsWith('.dae')) {
    const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
    const collada = new ColladaLoader(manager).parse(await file.text(), '')
    if (!collada?.scene) throw new Error(`failed to parse ${file.name}`)
    return collada.scene
  }
  throw new Error(`unsupported model format: ${file.name}`)
}

export async function convertModelFileToGlb(file: File, resources: File[] = []): Promise<File> {
  const resourceManager = createResourceManager(resources)
  try {
    const object = await parseToObject(file, resources, resourceManager.manager)
    await resourceManager.waitForLoads()
    const result = await new GLTFExporter().parseAsync(object, { binary: true })
    if (!(result instanceof ArrayBuffer)) {
      throw new Error('GLTFExporter did not return binary GLB')
    }
    return new File([result], `${baseNameNoExt(file.name)}.glb`, { type: 'model/gltf-binary' })
  } finally {
    resourceManager.dispose()
  }
}
