/**
 * Evaluate ComfyUI API-node price_badge JSONata expressions and format credits.
 * Mirrors ComfyUI frontend useNodePricing / comfyCredits (CREDITS_PER_USD = 211).
 */
import jsonata from 'jsonata'

export const CREDITS_PER_USD = 211

export type PriceBadge = {
  engine?: string
  expr: string
  depends_on?: {
    widgets?: Array<{ name: string; type?: string }>
    inputs?: string[]
    input_groups?: string[]
  }
}

export type PricingNodeInput = {
  id: string
  class_type: string
  title: string
  price_badge?: PriceBadge | null
  widgets?: Record<string, unknown>
  inputs?: Record<string, { connected: boolean }>
  input_groups?: Record<string, number>
}

type NormalizedWidgetValue = string | number | boolean | null

type PricingResult =
  | { type: 'text'; text: string }
  | { type: 'usd'; usd: number; format?: CreditFormatOptions }
  | { type: 'range_usd'; min_usd: number; max_usd: number; format?: CreditFormatOptions }
  | { type: 'list_usd'; usd: number[]; format?: CreditFormatOptions }

type CreditFormatOptions = {
  suffix?: string
  note?: string
  approximate?: boolean
  separator?: string
}

export type NodeCostLine = {
  id: string
  title: string
  class_type: string
  label: string
  usdMin: number | null
  usdMax: number | null
  text: string | null
}

export type WorkflowCostSummary = {
  label: string
  detail: string
  lines: NodeCostLine[]
  nodeCount: number
}

const compiledCache = new Map<string, ReturnType<typeof jsonata> | null>()

function asFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function normalizeWidgetValue(raw: unknown, declaredType: string): NormalizedWidgetValue {
  if (raw === undefined || raw === null) return null
  const upper = declaredType.toUpperCase()
  if (upper === 'INT' || upper === 'FLOAT') return asFiniteNumber(raw)
  if (upper === 'BOOLEAN') {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'string') {
      const ls = raw.trim().toLowerCase()
      if (ls === 'true') return true
      if (ls === 'false') return false
    }
    return null
  }
  if (upper === 'COMBO') {
    if (typeof raw === 'number' || typeof raw === 'boolean') return raw
    return String(raw).trim().toLowerCase()
  }
  return String(raw).trim().toLowerCase()
}

function shouldShowDecimal(value: number): boolean {
  const rounded = Math.round(value * 10) / 10
  return rounded % 1 !== 0
}

function formatCreditsNumber(credits: number): string {
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: shouldShowDecimal(credits) ? 1 : 0,
  }
  return new Intl.NumberFormat(undefined, opts).format(credits)
}

export function formatCreditsValue(usd: number): string {
  return formatCreditsNumber(usd * CREDITS_PER_USD)
}

function formatCreditsLabel(usd: number, fmt: CreditFormatOptions = {}): string {
  const prefix = fmt.approximate ? '~' : ''
  const suffix = fmt.suffix ?? '/Run'
  const note = fmt.note ? ` ${fmt.note}` : ''
  return `${prefix}${formatCreditsValue(usd)} credits${suffix}${note}`
}

function formatCreditsRangeLabel(minUsd: number, maxUsd: number, fmt: CreditFormatOptions = {}): string {
  const min = formatCreditsValue(minUsd)
  const max = formatCreditsValue(maxUsd)
  const value = min === max ? min : `${min}-${max}`
  const prefix = fmt.approximate ? '~' : ''
  const suffix = fmt.suffix ?? '/Run'
  const note = fmt.note ? ` ${fmt.note}` : ''
  return `${prefix}${value} credits${suffix}${note}`
}

function formatCreditsListLabel(usdValues: number[], fmt: CreditFormatOptions = {}): string {
  const sep = fmt.separator ?? '/'
  const value = usdValues.map(formatCreditsValue).join(sep)
  const prefix = fmt.approximate ? '~' : ''
  const suffix = fmt.suffix ?? '/Run'
  const note = fmt.note ? ` ${fmt.note}` : ''
  return `${prefix}${value} credits${suffix}${note}`
}

function isPricingResult(value: unknown): value is PricingResult {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof (value as { type: unknown }).type === 'string'
    && ['text', 'usd', 'range_usd', 'list_usd'].includes((value as { type: string }).type)
  )
}

export function formatPricingResult(result: unknown): string {
  if (result && typeof result === 'object' && !('type' in result) && 'usd' in result) {
    const usd = asFiniteNumber((result as { usd: unknown }).usd)
    return usd == null ? '' : formatCreditsLabel(usd)
  }
  if (!isPricingResult(result)) return ''
  if (result.type === 'text') return result.text ?? ''
  if (result.type === 'usd') {
    const usd = asFiniteNumber(result.usd)
    return usd == null ? '' : formatCreditsLabel(usd, result.format ?? {})
  }
  if (result.type === 'range_usd') {
    const minUsd = asFiniteNumber(result.min_usd)
    const maxUsd = asFiniteNumber(result.max_usd)
    if (minUsd == null || maxUsd == null) return ''
    return formatCreditsRangeLabel(minUsd, maxUsd, result.format ?? {})
  }
  if (result.type === 'list_usd') {
    const arr = Array.isArray(result.usd) ? result.usd : null
    if (!arr) return ''
    const usdValues = arr.map(asFiniteNumber).filter((x): x is number => x != null)
    if (!usdValues.length) return ''
    return formatCreditsListLabel(usdValues, result.format ?? {})
  }
  return ''
}

function usdSpanFromResult(result: unknown): { min: number | null; max: number | null; text: string | null } {
  if (result && typeof result === 'object' && !('type' in result) && 'usd' in result) {
    const usd = asFiniteNumber((result as { usd: unknown }).usd)
    return { min: usd, max: usd, text: null }
  }
  if (!isPricingResult(result)) return { min: null, max: null, text: null }
  if (result.type === 'text') return { min: null, max: null, text: result.text || null }
  if (result.type === 'usd') {
    const usd = asFiniteNumber(result.usd)
    return { min: usd, max: usd, text: null }
  }
  if (result.type === 'range_usd') {
    return {
      min: asFiniteNumber(result.min_usd),
      max: asFiniteNumber(result.max_usd),
      text: null,
    }
  }
  if (result.type === 'list_usd') {
    const vals = (Array.isArray(result.usd) ? result.usd : [])
      .map(asFiniteNumber)
      .filter((x): x is number => x != null)
    if (!vals.length) return { min: null, max: null, text: null }
    return { min: Math.min(...vals), max: Math.max(...vals), text: null }
  }
  return { min: null, max: null, text: null }
}

function getCompiled(classType: string, badge: PriceBadge) {
  const key = `${classType}::${badge.expr}`
  if (compiledCache.has(key)) return compiledCache.get(key) ?? null
  try {
    const expr = jsonata(badge.expr)
    compiledCache.set(key, expr)
    return expr
  } catch (e) {
    console.warn('[ComfyTV/api-cost] failed to compile price_badge', classType, e)
    compiledCache.set(key, null)
    return null
  }
}

function buildContext(node: PricingNodeInput, badge: PriceBadge) {
  const widgets: Record<string, NormalizedWidgetValue> = {}
  for (const dep of badge.depends_on?.widgets ?? []) {
    const raw = node.widgets?.[dep.name]
    widgets[dep.name] = normalizeWidgetValue(raw, dep.type || 'STRING')
  }
  const inputs: Record<string, { connected: boolean }> = {}
  for (const name of badge.depends_on?.inputs ?? []) {
    inputs[name] = { connected: !!node.inputs?.[name]?.connected }
  }
  const inputGroups: Record<string, number> = {}
  for (const group of badge.depends_on?.input_groups ?? []) {
    inputGroups[group] = Number(node.input_groups?.[group] || 0)
  }
  return { widgets, inputs, inputGroups }
}

export async function evaluateNodeCost(node: PricingNodeInput): Promise<NodeCostLine> {
  const badge = node.price_badge
  if (!badge?.expr || (badge.engine && badge.engine !== 'jsonata')) {
    return {
      id: node.id,
      title: node.title,
      class_type: node.class_type,
      label: badge ? '' : 'API',
      usdMin: null,
      usdMax: null,
      text: badge ? null : 'API',
    }
  }
  const compiled = getCompiled(node.class_type, badge)
  if (!compiled) {
    return {
      id: node.id,
      title: node.title,
      class_type: node.class_type,
      label: 'API',
      usdMin: null,
      usdMax: null,
      text: 'API',
    }
  }
  try {
    const result = await compiled.evaluate(buildContext(node, badge))
    const span = usdSpanFromResult(result)
    return {
      id: node.id,
      title: node.title,
      class_type: node.class_type,
      label: formatPricingResult(result) || 'API',
      usdMin: span.min,
      usdMax: span.max,
      text: span.text,
    }
  } catch (e) {
    console.warn('[ComfyTV/api-cost] evaluate failed', node.class_type, e)
    return {
      id: node.id,
      title: node.title,
      class_type: node.class_type,
      label: 'API',
      usdMin: null,
      usdMax: null,
      text: 'API',
    }
  }
}

export async function summarizeWorkflowCosts(nodes: PricingNodeInput[]): Promise<WorkflowCostSummary | null> {
  if (!nodes.length) return null
  const lines = await Promise.all(nodes.map(evaluateNodeCost))
  const usdLines = lines.filter(l => l.usdMin != null && l.usdMax != null) as Array<NodeCostLine & { usdMin: number; usdMax: number }>
  const textLines = lines.filter(l => l.text && l.usdMin == null)

  let label = ''
  if (usdLines.length) {
    const min = usdLines.reduce((s, l) => s + l.usdMin, 0)
    const max = usdLines.reduce((s, l) => s + l.usdMax, 0)
    const approx = usdLines.some(l => l.label.startsWith('~')) || min !== max
    label = min === max
      ? formatCreditsLabel(min, { approximate: approx })
      : formatCreditsRangeLabel(min, max, { approximate: true })
  } else if (textLines.length === 1) {
    label = textLines[0]!.text || 'API'
  } else if (lines.length) {
    label = `${lines.length} API`
  }

  if (textLines.length && usdLines.length) {
    label = `${label} + ${textLines.length > 1 ? `${textLines.length} API` : (textLines[0]!.text || 'API')}`
  }

  const detail = lines
    .map(l => `${l.title}: ${l.label || 'API'}`)
    .join('\n')

  return { label, detail, lines, nodeCount: lines.length }
}

/** Apply stage widget bindings (`option:…`, `literal:…`, `main_prompt`) onto node widgets. */
export function applyBindingOverrides(
  nodes: PricingNodeInput[],
  bindings: Array<{ node_id: string; input_name: string; from: string; default?: unknown }>,
  stageWidgets: Record<string, unknown>,
): PricingNodeInput[] {
  if (!bindings.length) return nodes
  const byId = new Map(nodes.map(n => [n.id, { ...n, widgets: { ...(n.widgets || {}) } }]))
  for (const b of bindings) {
    const node = byId.get(String(b.node_id))
    if (!node) continue
    const from = String(b.from || '')
    let value: unknown
    if (from.startsWith('literal:')) value = from.slice('literal:'.length)
    else if (from.startsWith('option:')) {
      const key = from.slice('option:'.length)
      value = stageWidgets[key]
      if (value === undefined || value === null || value === '') value = b.default
    } else if (from === 'main_prompt' || from === 'prompt') {
      value = stageWidgets.main_prompt ?? stageWidgets.prompt
      if (value === undefined || value === null || value === '') value = b.default
    } else {
      continue
    }
    if (value === undefined) continue
    node.widgets![b.input_name] = value
  }
  return [...byId.values()]
}
