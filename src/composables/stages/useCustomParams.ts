import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { StageParam } from '@/api/schemas'
import { getStageMeta } from '@/composables/stages/stageMeta'
import { useBoundOptionKeys } from '@/composables/stages/useBoundOptionKeys'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { useStageParamStore } from '@/stores/stageParamStore'
import { bindWidgetCallback, getWidget, readWidgetStr, writeWidget } from '@/utils/widget'

export interface ParamItem {
  key: string
  value: unknown
}

export function parseParamItems(raw: string): ParamItem[] {
  try {
    const data = JSON.parse(raw)
    const arr = data?.items
    return Array.isArray(arr)
      ? arr
        .filter((x: any) => x && typeof x.key === 'string')
        .map((x: any) => ({ key: x.key, value: x.value }))
      : []
  } catch {
    return []
  }
}

export function serializeParamItems(items: ParamItem[]): string {
  return JSON.stringify({ items })
}

export function comboOptionsOf(d: StageParam | undefined): string[] {
  const opts = d?.config?.options
  return Array.isArray(opts) ? opts.map(o => String(o)) : []
}

export function defaultParamValue(d: StageParam): unknown {
  if (d.default != null) return d.default
  switch (d.type) {
    case 'boolean': return false
    case 'int':
    case 'float':   return 0
    case 'combo':   return comboOptionsOf(d)[0] ?? ''
    default:        return ''
  }
}

/** Rebuild items so every bound StageParam key without a stage widget is present. */
export function syncBoundParamItems(
  current: ParamItem[],
  boundKeys: Set<string>,
  defs: StageParam[],
  widgetNames: Set<string> = new Set(),
): ParamItem[] {
  const byKey = new Map(current.map(it => [it.key, it]))
  const next: ParamItem[] = []
  for (const d of defs) {
    if (!boundKeys.has(d.key)) continue
    if (widgetNames.has(d.key)) continue
    const prev = byKey.get(d.key)
    next.push(prev ? { key: d.key, value: prev.value } : { key: d.key, value: defaultParamValue(d) })
  }
  // Keep non-def keys (dynamic unknowns from layer C) that are still bound.
  for (const it of current) {
    if (defs.some(d => d.key === it.key)) continue
    if (!boundKeys.has(it.key)) continue
    if (widgetNames.has(it.key)) continue
    next.push(it)
  }
  return next
}

function itemsEqual(a: ParamItem[], b: ParamItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((it, i) => it.key === b[i]!.key && it.value === b[i]!.value)
}

export function useCustomParams(node: LGraphNode, getState: () => StageState) {
  const store = useStageParamStore()
  const items = ref<ParamItem[]>([])

  const paramKind = computed(() =>
    getStageMeta(node.comfyClass ?? '')?.workflow_kind || getState().kind)
  const hasWidget = computed(() => !!getWidget(node, 'custom_params'))
  const defs = computed(() => store.forKind(paramKind.value).filter(d => d.origin !== 0))

  const { keys: boundKeys } = useBoundOptionKeys(() => node, paramKind)

  const widgetNames = computed(() => new Set(
    ((node.widgets ?? []) as any[])
      .map(w => String(w?.name ?? ''))
      .filter(Boolean),
  ))

  const attached = computed(() =>
    items.value.filter(it =>
      defs.value.some(d => d.key === it.key)
      && !widgetNames.value.has(it.key),
    ))

  /** Bound keys with neither a StageParam def nor a stage widget — layer C. */
  const dynamicAttached = computed(() => {
    const defKeys = new Set(defs.value.map(d => d.key))
    return items.value.filter(it =>
      boundKeys.value.has(it.key)
      && !defKeys.has(it.key)
      && !widgetNames.value.has(it.key),
    )
  })

  function defByKey(key: string): StageParam | undefined {
    return defs.value.find(d => d.key === key)
  }
  function defLabel(key: string): string { return defByKey(key)?.label ?? key }
  function defType(key: string): string { return defByKey(key)?.type ?? 'string' }
  function cfg(key: string): Record<string, unknown> { return defByKey(key)?.config ?? {} }
  function cfgNum(key: string, k: string): number | undefined {
    const v = cfg(key)[k]
    return typeof v === 'number' ? v : undefined
  }
  function cfgStr(key: string, k: string): string | undefined {
    const v = cfg(key)[k]
    return typeof v === 'string' ? v : undefined
  }
  function numVal(v: unknown): number | null {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  function useSlider(key: string): boolean {
    return defType(key) === 'int'
      && cfgNum(key, 'min') !== undefined
      && cfgNum(key, 'max') !== undefined
  }
  function comboOptions(key: string): string[] {
    return comboOptionsOf(defByKey(key))
  }

  function readItems(): ParamItem[] {
    return parseParamItems(readWidgetStr(node, 'custom_params', '{}'))
  }

  function persist(): void {
    writeWidget(node, 'custom_params', serializeParamItems(items.value))
  }

  function applyBoundSync(): void {
    if (!hasWidget.value) return
    const next = syncBoundParamItems(
      items.value,
      boundKeys.value,
      defs.value,
      widgetNames.value,
    )
    if (itemsEqual(items.value, next)) return
    items.value = next
    persist()
  }

  function setVal(key: string, value: unknown): void {
    if (items.value.some(it => it.key === key)) {
      items.value = items.value.map(it => (it.key === key ? { ...it, value } : it))
    } else {
      items.value = [...items.value, { key, value }]
    }
    persist()
  }

  /** Ensure a dynamic (no def / no widget) bound key has a row. */
  function ensureDynamic(key: string, value: unknown = ''): void {
    if (items.value.some(it => it.key === key)) return
    items.value = [...items.value, { key, value }]
    persist()
  }

  onMounted(async () => {
    store.ensureHydrated()
    store.installWebSocketSync()
    await store.hydrate()
    items.value = readItems()
    applyBoundSync()
    bindWidgetCallback(node, 'custom_params', () => { items.value = readItems() })
  })

  watch(
    () => [paramKind.value, [...boundKeys.value].sort().join('\0'), defs.value.map(d => d.key).join('\0')] as const,
    () => { applyBoundSync() },
  )

  onBeforeUnmount(() => {})

  return {
    items,
    hasWidget,
    defs,
    boundKeys,
    attached,
    dynamicAttached,
    defLabel,
    defType,
    cfg,
    cfgNum,
    cfgStr,
    numVal,
    useSlider,
    comboOptions,
    setVal,
    ensureDynamic,
  }
}
