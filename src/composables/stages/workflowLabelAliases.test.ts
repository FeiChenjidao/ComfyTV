import { describe, expect, it } from 'vitest'

import { canonicalWorkflowLabel, migrateWorkflowLabel } from './workflowLabelAliases'

describe('workflow label aliases', () => {
  it('renames the legacy NanoBanana2 workflow', () => {
    expect(canonicalWorkflowLabel('image', 'NanoBanana2')).toBe('NanoBanana 2.1')
  })

  it('updates a restored workflow widget in place', () => {
    const node = { widgets: [{ name: 'workflow', value: 'NanoBanana2' }] }
    expect(migrateWorkflowLabel(node, 'image')).toBe(true)
    expect(node.widgets[0].value).toBe('NanoBanana 2.1')
  })

  it('leaves unrelated labels unchanged', () => {
    expect(canonicalWorkflowLabel('video', 'NanoBanana2')).toBe('NanoBanana2')
  })

  it('migrates renamed image and model providers without changing other kinds', () => {
    expect(canonicalWorkflowLabel('image', 'GPT_Image_2.5')).toBe('GPT_Image_2.6')
    expect(canonicalWorkflowLabel('model', 'Meshy')).toBe('Meshy Multi')
    expect(canonicalWorkflowLabel('video', 'Meshy')).toBe('Meshy')
  })
})
