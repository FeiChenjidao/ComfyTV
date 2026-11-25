import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }))

vi.mock('@/utils/download', () => ({ downloadBlob: mocks.downloadBlob }))

import { exportModelObject, MODEL_EXPORT_FORMATS } from './modelExporter'

function model(): THREE.Group {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6699cc }),
  ))
  return root
}

describe('modelExporter', () => {
  beforeEach(() => mocks.downloadBlob.mockReset())

  it('exports the four formats offered by the model loader', async () => {
    expect(MODEL_EXPORT_FORMATS).toEqual(['glb', 'obj', 'stl', 'fbx'])

    for (const format of MODEL_EXPORT_FORMATS) {
      await exportModelObject(model(), format, 'sample.glb')
      const [filename, blob] = mocks.downloadBlob.mock.calls.at(-1) as [string, Blob]
      expect(filename).toBe(format === 'obj' ? 'sample_obj.zip' : `sample.${format}`)
      expect(blob.size).toBeGreaterThan(20)
    }
  })

  it('rejects non-mesh scenes instead of downloading an empty file', async () => {
    await expect(exportModelObject(new THREE.Group(), 'obj')).rejects.toThrow(/no exportable mesh/i)
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })
})
