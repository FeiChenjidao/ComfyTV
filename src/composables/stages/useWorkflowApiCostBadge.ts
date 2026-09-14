import { computed, onUnmounted, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'

import { fetchWorkflowApiCost } from '@/api'
import { loadStageMeta, getStageMeta } from '@/composables/stages/stageMeta'
import {
  applyBindingOverrides,
  summarizeWorkflowCosts,
  type WorkflowCostSummary,
} from '@/composables/stages/workflowApiCost'
import type { LGraphNode } from '@/lib/comfyApp'

function readWidgetMap(node: LGraphNode | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const w of node?.widgets ?? []) {
    if (w?.name) out[w.name] = w.value
  }
  return out
}

/**
 * Reactive estimate of paid ComfyUI API-node credits inside the bound workflow.
 */
export function useWorkflowApiCostBadge(
  getNode: () => LGraphNode | undefined,
  workflowLabel: MaybeRefOrGetter<string>,
  widgetTick?: MaybeRefOrGetter<unknown>,
) {
  const summary = ref<WorkflowCostSummary | null>(null)
  const loading = ref(false)
  let seq = 0

  async function reload() {
    const node = getNode()
    const label = String(toValue(workflowLabel) || '').trim()
    await loadStageMeta()
    const cls = (node as any)?.comfyClass || node?.type
    const kind = cls ? (getStageMeta(String(cls))?.workflow_kind || '') : ''
    const my = ++seq
    if (!kind || !label) {
      summary.value = null
      return
    }
    loading.value = true
    try {
      const payload = await fetchWorkflowApiCost(kind, label)
      if (my !== seq) return
      if (!payload.nodes?.length) {
        summary.value = null
        return
      }
      const widgets = readWidgetMap(node)
      const nodes = applyBindingOverrides(
        payload.nodes.map(n => ({
          id: n.id,
          class_type: n.class_type,
          title: n.title,
          price_badge: n.price_badge ?? null,
          widgets: n.widgets ?? {},
          inputs: n.inputs ?? {},
          input_groups: n.input_groups ?? {},
        })),
        (payload.bindings ?? []).map(b => ({
          node_id: b.node_id,
          input_name: b.input_name,
          from: b.from,
          default: b.default,
        })),
        widgets,
      )
      const next = await summarizeWorkflowCosts(nodes)
      if (my !== seq) return
      summary.value = next
    } catch (e) {
      if (my !== seq) return
      console.warn('[ComfyTV/api-cost] fetch failed', e)
      summary.value = null
    } finally {
      if (my === seq) loading.value = false
    }
  }

  watch(
    () => [toValue(workflowLabel), toValue(widgetTick)] as const,
    () => { void reload() },
    { immediate: true },
  )

  onUnmounted(() => { seq += 1 })

  const label = computed(() => summary.value?.label || '')
  const detail = computed(() => summary.value?.detail || '')
  const visible = computed(() => !!summary.value?.label)

  return { summary, label, detail, visible, loading, reload }
}
