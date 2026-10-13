import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/comfyApp', () => ({
  app: {
    canvas: {
      canvas: document.createElement('canvas'),
      selected_nodes: { 1: {} },
    },
  },
}))

describe('installDeleteKeyFix', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('blurs non-text focus when Delete is pressed with a selection', async () => {
    const { installDeleteKeyFix } = await import('./deleteKeyFix')
    installDeleteKeyFix()
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.focus()
    expect(document.activeElement).toBe(btn)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    expect(document.activeElement).toBe(document.body)
  })

  it('does not blur while typing in a text input', async () => {
    const { installDeleteKeyFix } = await import('./deleteKeyFix')
    installDeleteKeyFix()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
    }))
    expect(document.activeElement).toBe(input)
  })
})
