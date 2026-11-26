const WORKFLOW_LABEL_ALIASES: Record<string, Record<string, string>> = {
  image: {
    NanoBanana2: 'NanoBanana 2.1',
    'GPT_Image_2.5': 'GPT_Image_2.6',
  },
  model: { Meshy: 'Meshy Multi' },
  'layer-separation': { 'Seedream5.0Pro 图层分离': 'Seedream5.5 图层分离' },
}

export function canonicalWorkflowLabel(kind: string, label: unknown): string {
  const value = String(label ?? '')
  return WORKFLOW_LABEL_ALIASES[kind]?.[value] ?? value
}

export function migrateWorkflowLabel(node: any, kind: string): boolean {
  const widget = node?.widgets?.find((item: any) => item.name === 'workflow')
  if (!widget) return false
  const next = canonicalWorkflowLabel(kind, widget.value)
  if (next === String(widget.value ?? '')) return false
  widget.value = next
  return true
}
