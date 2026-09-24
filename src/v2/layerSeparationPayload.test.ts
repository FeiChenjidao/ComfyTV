import { describe, expect, it } from 'vitest'

import { compositorUiFromLayerGroup } from './layerSeparationPayload'

describe('compositorUiFromLayerGroup', () => {
  it('restores the official compositor preview from a layer group', () => {
    const ui = compositorUiFromLayerGroup(JSON.stringify({
      images: [
        { index: '1', label: 'Background', image_url: '/view?filename=background.png' },
        { index: '2', label: 'Subject', image_url: '/view?filename=subject.png' },
      ],
      compositor_preview: {
        filename: 'composite.png', subfolder: 'layers', type: 'output',
      },
      compositor_layers: [
        { filename: 'background.png', subfolder: 'layers', type: 'output' },
        { filename: 'subject.png', subfolder: 'layers', type: 'output' },
      ],
      compositor_inputs: ['a', 'b'],
      compositor_bboxes: [{ name: 'Background' }, { name: 'Subject' }],
      compositor_canvas: [{ w: 1024, h: 1024 }],
    }))

    expect(ui?.images).toEqual([
      { filename: 'composite.png', subfolder: 'layers', type: 'output' },
    ])
    expect(ui?.compositor_layers).toHaveLength(2)
    expect(ui?.compositor_inputs).toEqual(['a', 'b'])
  })

  it('rejects payloads without compositor layers', () => {
    expect(compositorUiFromLayerGroup('{"images":[]}')).toBeNull()
    expect(compositorUiFromLayerGroup('/view?filename=image.png')).toBeNull()
  })
})
