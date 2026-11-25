import '@/tailwind.css'
import '@/style.css'

import { createPinia } from 'pinia'
import { createApp, h, ref } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

import ModelPreview from '@/components/stages/ModelPreview.vue'
import ModelExportButton from '@/components/stages/ModelExportButton.vue'
import { exportModelObject, type ModelExportFormat } from '@/widgets/three/modelExporter'
import { i18n } from '@/i18n'

const modelUrl = new URLSearchParams(location.search).get('model') || JSON.stringify({
  __prim__: { kind: 'torus', radius: 0.72, tube: 0.24, radialSegments: 32, tubularSegments: 96 },
})
const container = document.querySelector('#app') as HTMLElement
const preview = ref<InstanceType<typeof ModelPreview> | null>(null)

const app = createApp({
  render: () => h('div', { style: 'position:relative;width:100%;height:100%' }, [
    h(ModelPreview, {
      ref: preview, src: modelUrl, controls: true,
      onViewChanged: () => { (window as any).uiReady = true },
    }),
    h('div', { style: 'position:absolute;right:8px;top:8px' }, [
      h(ModelExportButton, { exportModel: (format) => preview.value!.exportModel(format, 'viewer') }),
    ]),
  ]),
})
app.use(createPinia())
app.use(i18n)
app.mount(container)

;(window as any).exportTexturedFixture = async (format: ModelExportFormat) => {
  const texture = new THREE.DataTexture(new Uint8Array([
    240, 64, 192, 255, 20, 100, 200, 255,
    30, 80, 160, 255, 200, 128, 32, 255,
  ]), 2, 2)
  texture.flipY = false
  texture.needsUpdate = true
  const material = new THREE.MeshStandardMaterial({
    map: texture, roughnessMap: texture, metalnessMap: texture,
    normalMap: texture, aoMap: texture, emissiveMap: texture,
  })
  const second = new THREE.MeshStandardMaterial({ color: 0xff0000, map: texture })
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [material, second])
  mesh.geometry.groups.forEach((group, i) => { group.materialIndex = i % 2 })
  mesh.position.set(3, 2, 1)
  try { await exportModelObject(mesh, format, 'textured') }
  finally { mesh.geometry.dispose(); material.dispose(); second.dispose(); texture.dispose() }
}

;(window as any).readExportedModel = async (bytes: number[], format: 'glb' | 'fbx') => {
  const buffer = new Uint8Array(bytes).buffer
  const root = format === 'glb' ? (await new GLTFLoader().parseAsync(buffer, '')).scene : new FBXLoader().parse(buffer, '')
  const materials: THREE.MeshStandardMaterial[] = []
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) materials.push(...(Array.isArray(object.material) ? object.material : [object.material]))
  })
  return materials.map((material) => ({
    textured: !!material.map, roughnessMap: !!material.roughnessMap,
    metalnessMap: !!material.metalnessMap, normalMap: !!material.normalMap,
  }))
}
