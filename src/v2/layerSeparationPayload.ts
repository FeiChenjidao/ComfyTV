interface ImageRef {
  filename: string
  subfolder: string
  type: string
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
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

function compositorUiFromObject(data: Record<string, unknown>, includeImages: boolean) {
  const layers = Array.isArray(data.compositor_layers)
    ? data.compositor_layers.map(imageRef).filter((ref): ref is ImageRef => ref !== null)
    : []
  if (!layers.length) return null

  const ui: Record<string, unknown> = { compositor_layers: layers }
  const preview = imageRef(data.compositor_preview)
  if (preview) ui.images = [preview]
  else if (includeImages && Array.isArray(data.images)) {
    const images = data.images.map(imageRef).filter((ref): ref is ImageRef => ref !== null)
    if (images.length) ui.images = images
  }
  for (const key of ['compositor_inputs', 'compositor_bboxes', 'compositor_canvas']) {
    if (Array.isArray(data[key])) ui[key] = data[key]
  }
  return ui
}

export function compositorUiFromLayerGroup(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (!raw?.trimStart().startsWith('{')) return null
  const data = parseObject(raw)
  return data ? compositorUiFromObject(data, false) : null
}

export function compositorUiFromPersisted(
  value: unknown,
): Record<string, unknown> | null {
  const data = parseObject(value)
  return data ? compositorUiFromObject(data, true) : null
}
