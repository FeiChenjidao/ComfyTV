interface ImageRef {
  filename: string
  subfolder: string
  type: string
}

function imageRef(value: unknown): ImageRef | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as Record<string, unknown>
  if (!ref.filename) return null
  return {
    filename: String(ref.filename),
    subfolder: String(ref.subfolder ?? ''),
    type: String(ref.type || 'output'),
  }
}

export function compositorUiFromLayerGroup(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (!raw?.trimStart().startsWith('{')) return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  const layers = Array.isArray(data.compositor_layers)
    ? data.compositor_layers.map(imageRef).filter((ref): ref is ImageRef => ref !== null)
    : []
  if (!layers.length) return null

  const ui: Record<string, unknown> = { compositor_layers: layers }
  const preview = imageRef(data.compositor_preview)
  if (preview) ui.images = [preview]
  for (const key of ['compositor_inputs', 'compositor_bboxes', 'compositor_canvas']) {
    if (Array.isArray(data[key])) ui[key] = data[key]
  }
  return ui
}
