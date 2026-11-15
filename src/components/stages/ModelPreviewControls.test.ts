import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'

import { renderWithPlugins } from '@/__tests__/renderHelpers'
import { MATERIAL_MAP_KEYS } from '@/widgets/material/types'
import ModelPreviewControls from './ModelPreviewControls.vue'
import { DEFAULT_PREVIEW_PBR } from './modelPreviewTypes'

function renderControls(overrides: Record<string, unknown> = {}) {
  return renderWithPlugins(ModelPreviewControls, {
    props: {
      channel: 'material',
      normalMode: 'geometry',
      hasNormalMap: false,
      lighting: 'default',
      pbr: { ...DEFAULT_PREVIEW_PBR },
      mapSlots: MATERIAL_MAP_KEYS.map((key) => ({
        key,
        previewUrl: null,
        source: 'empty' as const,
        count: 0,
      })),
      stats: {
        vertices: 24,
        triangles: 12,
        meshes: 1,
        materials: 1,
        size: [1, 1, 1] as [number, number, number],
      },
      fullscreen: false,
      ...overrides,
    },
  })
}

describe('ModelPreviewControls', () => {
  it('selects a material map slot and emits the chosen custom file', async () => {
    const { container, emitted } = renderControls()
    await fireEvent.click(screen.getByTitle('Material inspector'))
    await fireEvent.click(screen.getByRole('button', { name: /Normal Not assigned/ }))
    await fireEvent.click(screen.getAllByTitle('Replace')[0])

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['normal'], 'normal.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await fireEvent.change(input)

    expect(emitted()['map-file']).toEqual([['normalMap', file]])
  })

  it('emits PBR multiplier changes and reset', async () => {
    const { emitted } = renderControls()
    await fireEvent.click(screen.getByTitle('Material inspector'))
    await fireEvent.click(screen.getByRole('button', { name: 'PBR' }))
    await fireEvent.update(screen.getByRole('slider', { name: /Normal scale/ }), '1.5')
    await fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(emitted()['update:pbr']).toEqual([['normalScale', 1.5]])
    expect(emitted()['reset-pbr']).toHaveLength(1)
  })

  it('switches between geometry and normal-map previews', async () => {
    const { emitted } = renderControls({ channel: 'normal', hasNormalMap: true })

    await fireEvent.click(screen.getByRole('button', { name: 'Normal map' }))

    expect(emitted()['update:normal-mode']).toEqual([['texture']])
  })

  it('disables normal-map preview when the model has no normal map', () => {
    renderControls({ channel: 'normal' })

    expect(screen.getByRole('button', { name: 'Normal map' })).toBeDisabled()
  })
})
