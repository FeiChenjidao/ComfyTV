import { createApp, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useWidgetValues } from './useWidgetValues'

describe('useWidgetValues', () => {
  it('marks the workflow changed when a V2 control writes a widget', () => {
    const callback = vi.fn()
    const change = vi.fn()
    const setDirtyCanvas = vi.fn()
    const node = {
      widgets: [{ name: 'duration_s', value: 5, callback }],
      graph: { change },
      setDirtyCanvas,
    } as any
    let write!: (name: string, value: unknown) => void
    const host = document.createElement('div')
    const app = createApp({
      setup() {
        ;({ write } = useWidgetValues(() => node, ['duration_s']))
        return () => h('div')
      },
    })
    app.mount(host)

    write('duration_s', 8)

    expect(node.widgets[0].value).toBe(8)
    expect(callback).toHaveBeenCalledWith(8)
    expect(change).toHaveBeenCalledOnce()
    expect(setDirtyCanvas).toHaveBeenCalledWith(true, true)

    write('duration_s', 8)
    expect(change).toHaveBeenCalledOnce()
    app.unmount()
  })
})
