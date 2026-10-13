import type { Pinia } from 'pinia'
import { createApp, type App } from 'vue'

import { guardGhostPlacement } from '@/composables/ghostPlacementInert'
import { i18n } from '@/i18n'
import { app } from '@/lib/comfyApp'

import BottomBar from './BottomBar.vue'

const HOST_ID = 'comfytv-bottom-bar'
const MAX_FRAMES = 600

interface Mounted {
  host: HTMLElement
  vue: App
  unguard: () => void
}

let pinia: Pinia | null = null
let mounted: Mounted | null = null
let retry = 0
let pending = false

function mountOnce(): void {
  if (!document.body) {
    if (retry++ < MAX_FRAMES) requestAnimationFrame(mountOnce)
    else pending = false
    return
  }
  retry = 0
  pending = false
  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement('div')
  host.id = HOST_ID
  host.className = 'comfytv-root'
  document.body.append(host)

  const vue = createApp(BottomBar)
  if (pinia) vue.use(pinia)
  vue.use(i18n)
  vue.mount(host)
  mounted = {
    host,
    vue,
    unguard: guardGhostPlacement(app, host),
  }
}

export function installBottomBar(activePinia: Pinia): void {
  pinia = activePinia
  if (mounted?.host.isConnected) return
  if (pending) return
  pending = true
  mounted = null
  mountOnce()
}

export function uninstallBottomBar(): void {
  if (!mounted) return
  mounted.unguard()
  mounted.vue.unmount()
  mounted.host.remove()
  mounted = null
}
