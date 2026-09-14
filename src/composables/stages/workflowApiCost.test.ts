import { describe, expect, it } from 'vitest'

import {
  applyBindingOverrides,
  evaluateNodeCost,
  formatCreditsValue,
  formatPricingResult,
  summarizeWorkflowCosts,
} from './workflowApiCost'

describe('workflowApiCost formatting', () => {
  it('converts usd to credits at 211×', () => {
    expect(formatCreditsValue(0.05)).toBe('10.6')
    expect(formatCreditsValue(1)).toBe('211')
  })

  it('formats usd pricing results', () => {
    expect(formatPricingResult({ type: 'usd', usd: 0.05 })).toBe('10.6 credits/Run')
    expect(formatPricingResult({ type: 'usd', usd: 1, format: { approximate: true } }))
      .toBe('~211 credits/Run')
  })

  it('formats text and range results', () => {
    expect(formatPricingResult({ type: 'text', text: 'Token-based' })).toBe('Token-based')
    expect(formatPricingResult({ type: 'range_usd', min_usd: 0.05, max_usd: 0.1 }))
      .toBe('10.6-21.1 credits/Run')
  })
})

describe('workflowApiCost evaluate', () => {
  it('evaluates a static price_badge expression', async () => {
    const line = await evaluateNodeCost({
      id: '1',
      class_type: 'TestNode',
      title: 'Test',
      price_badge: { engine: 'jsonata', expr: '{"type":"usd","usd":0.05}' },
      widgets: {},
    })
    expect(line.label).toBe('10.6 credits/Run')
    expect(line.usdMin).toBe(0.05)
  })

  it('evaluates widget-dependent expressions', async () => {
    const line = await evaluateNodeCost({
      id: '2',
      class_type: 'WanNode',
      title: 'Wan',
      price_badge: {
        engine: 'jsonata',
        depends_on: { widgets: [{ name: 'duration', type: 'INT' }, { name: 'size', type: 'COMBO' }] },
        expr: `(
          $ppsTable := { "480p": 0.05, "720p": 0.1 };
          $resKey := $substringBefore(widgets.size, ":");
          $pps := $lookup($ppsTable, $resKey);
          { "type": "usd", "usd": $round($pps * widgets.duration, 2) }
        )`,
      },
      widgets: { duration: 5, size: '720p:1280x720' },
    })
    expect(line.usdMin).toBe(0.5)
    expect(line.label).toBe('105.5 credits/Run')
  })

  it('sums multiple nodes', async () => {
    const summary = await summarizeWorkflowCosts([
      {
        id: '1',
        class_type: 'A',
        title: 'A',
        price_badge: { expr: '{"type":"usd","usd":0.05}' },
      },
      {
        id: '2',
        class_type: 'B',
        title: 'B',
        price_badge: { expr: '{"type":"usd","usd":0.1}' },
      },
    ])
    // 0.15 USD × 211 = 31.65 → rounds to 31.7 for display
    expect(summary?.label).toBe('31.7 credits/Run')
    expect(summary?.nodeCount).toBe(2)
    expect(summary?.detail).toContain('A:')
  })
})

describe('applyBindingOverrides', () => {
  it('overlays option/literal bindings onto widgets', () => {
    const nodes = applyBindingOverrides(
      [{
        id: '9',
        class_type: 'X',
        title: 'X',
        widgets: { duration: 2, size: '480p:x' },
      }],
      [
        { node_id: '9', input_name: 'size', from: 'option:resolution' },
        { node_id: '9', input_name: 'duration', from: 'literal:8' },
      ],
      { resolution: '1080p:z' },
    )
    expect(nodes[0]!.widgets!.size).toBe('1080p:z')
    expect(nodes[0]!.widgets!.duration).toBe('8')
  })

  it('falls back to binding default when option is empty', () => {
    const nodes = applyBindingOverrides(
      [{ id: '1', class_type: 'X', title: 'X', widgets: { size: 'a' } }],
      [{ node_id: '1', input_name: 'size', from: 'option:resolution', default: 'fallback' }],
      { resolution: '' },
    )
    expect(nodes[0]!.widgets!.size).toBe('fallback')
  })
})
