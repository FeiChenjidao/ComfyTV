import { getStageMeta } from '@/composables/stages/stageMeta'
import { loadWorkflowInfo } from '@/composables/stages/useWorkflowValidator'
import { getWidget } from '@/utils/widget'

const SIZING_WIDGETS = ['resolution', 'aspect_ratio']

export async function sizingWarnings(node: any, widgets: unknown): Promise<string[]> {
  if (!widgets || typeof widgets !== 'object') return []
  const touched = SIZING_WIDGETS.filter(k => k in (widgets as Record<string, unknown>))
  if (!touched.length) return []
  const kind = getStageMeta(node?.comfyClass)?.workflow_kind
  const label = String(getWidget(node, 'workflow')?.value ?? '')
  if (!kind || !label) return []
  const info = await loadWorkflowInfo()
  const entry = (info as any)?.[kind]?.[label]
  const computed = entry?.uses_computed
  const options = entry?.uses_options
  // API-style nodes (Nano Banana 2, …) bind Stage resolution/aspect_ratio as
  // option:* onto the model's own COMBO — that still drives output size.
  if (options?.aspect_ratio || options?.resolution) return []
  if (!computed || computed.width || computed.height) return []
  return [
    `${touched.join('/')} will not affect workflow '${label}' — it binds neither `
    + 'computed:width/height nor option:aspect_ratio/resolution, so the output '
    + "size comes from the workflow's own nodes (for image-to-image workflows, "
    + 'the input image)',
  ]
}
