import '@/tailwind.css'
import '@/style.css'

import { createPinia } from 'pinia'
import { createApp, h } from 'vue'

import ModelPreview from '@/components/stages/ModelPreview.vue'
import { i18n } from '@/i18n'

const modelUrl = JSON.stringify({
  __prim__: { kind: 'torus', radius: 0.72, tube: 0.24, radialSegments: 32, tubularSegments: 96 },
})
const container = document.querySelector('#app') as HTMLElement

const app = createApp({
  render: () => h(ModelPreview, {
    src: modelUrl,
    controls: true,
    onViewChanged: () => {
      ;(window as unknown as { uiReady: boolean }).uiReady = true
    },
  }),
})
app.use(createPinia())
app.use(i18n)
app.mount(container)
