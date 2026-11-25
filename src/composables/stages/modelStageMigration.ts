import type { LGraphNode } from '@/lib/comfyApp'

/** Restore the layout before model history added selected_index/pool/append_results. */
export function migrateModelStageConfigureInfo(
  node: LGraphNode,
  info: { widgets_values?: unknown[]; widgets_values_named?: Record<string, unknown> } | null | undefined,
): boolean {
  const values = info?.widgets_values
  if (info?.widgets_values_named?.selected_index != null) return false
  const index = node.widgets?.findIndex(widget => widget.name === 'selected_index') ?? -1
  if (!Array.isArray(values) || index < 0 || values.length > index + 3) return false
  const oldCustom = values[index]
  if (typeof oldCustom !== 'string' || !oldCustom.trimStart().startsWith('{')) return false
  try {
    const parsed = JSON.parse(oldCustom)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  } catch {
    return false
  }
  values.splice(index, 0, 1, '', true)
  // LiteGraph invokes onConfigure after its positional widget restoration.
  // Repair the live tail as well as the saved array before stage bindings run.
  for (let i = index; i < values.length; i++) {
    const widget = node.widgets?.[i]
    if (widget && widget.serialize !== false) widget.value = values[i] as any
  }
  return true
}

export function normalizeModelStageWidgets(node: LGraphNode): void {
  const seed = node.widgets?.find(widget => widget.name === 'seed')
  const append = node.widgets?.find(widget => widget.name === 'append_results')
  if (seed && seed.value == null) seed.value = 0
  if (append && typeof append.value !== 'boolean') append.value = true
}
