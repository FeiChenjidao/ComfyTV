import { ref } from 'vue'
import type { Ref } from 'vue'

import { app } from './scripts/app'

const versions = new Map<string, Ref<number>>()
const subscribed = new Set<string>()

export function hostPinia(): any {
  return app.extensionManager?._p ?? null
}

export function hostStore(id: string): any {
  return hostPinia()?._s?.get(id) ?? null
}

function attach(id: string, version: Ref<number>, framesLeft = 600): void {
  if (subscribed.has(id)) return
  const store = hostStore(id)
  if (!store) {
    if (framesLeft > 0) requestAnimationFrame(() => attach(id, version, framesLeft - 1))
    return
  }
  subscribed.add(id)
  store.$subscribe(() => { version.value++ }, { detached: true, flush: 'post' })
  version.value++
}

export function hostVersion(id: string): Ref<number> {
  let version = versions.get(id)
  if (!version) {
    version = ref(0)
    versions.set(id, version)
  }
  attach(id, version)
  return version
}

export function hostManager(): any {
  return app.extensionManager ?? null
}
