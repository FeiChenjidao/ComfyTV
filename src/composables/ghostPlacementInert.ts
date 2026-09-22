import { useEventListener, useRafFn } from '@vueuse/core'
import { effectScope, shallowRef } from 'vue'

const hosts = new Set<HTMLElement>()
let placing = false
let installed = false

function apply(el: HTMLElement) {
  el.toggleAttribute('inert', placing)
}

function install(app: any): void {
  if (installed) return
  installed = true
  const scope = effectScope(true)
  scope.run(() => {
    const target = shallowRef<HTMLCanvasElement | null>(null)
    const seek = useRafFn(() => {
      const el = app?.canvas?.canvas
      if (!el) return
      target.value = el
      seek.pause()
    })
    useEventListener(
      target,
      'litegraph:ghost-placement',
      (e: CustomEvent<{ active: boolean }>) => {
        placing = !!e.detail?.active
        for (const el of hosts) apply(el)
      },
    )
  })
}

export function guardGhostPlacement(app: any, el: HTMLElement): () => void {
  install(app)
  hosts.add(el)
  apply(el)
  return () => {
    hosts.delete(el)
    el.removeAttribute('inert')
  }
}
