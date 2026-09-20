import { computed, reactive } from 'vue'

export type LightboxKind = 'image' | 'video' | 'audio' | 'model'

export interface LightboxItem {
  url: string
  label?: string
  kind?: LightboxKind
}

// a trailing " [output]" annotation can follow the extension, hence \s in the lookahead
const VIDEO_URL_RE = /\.(3g2|3gp|avi|m4v|mkv|mov|mp4|mpe?g|ogv|webm)(?=$|[\s?&#])/i
const AUDIO_URL_RE = /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)(?=$|[\s?&#])/i
const MODEL_URL_RE = /\.(glb|gltf|obj|fbx|ply|stl)(?=$|[\s?&#])/i

export function lightboxKind(item: LightboxItem): LightboxKind {
  if (item.kind) return item.kind
  const url = decodeURIComponent(item.url)
  if (VIDEO_URL_RE.test(url)) return 'video'
  if (AUDIO_URL_RE.test(url)) return 'audio'
  if (MODEL_URL_RE.test(url)) return 'model'
  return 'image'
}

export function isVideoLightboxItem(item: LightboxItem): boolean {
  return lightboxKind(item) === 'video'
}

const state = reactive<{ items: LightboxItem[]; index: number }>({
  items: [],
  index: -1,
})

export function openLightbox(items: LightboxItem[], startIndex = 0): void {
  const clean = items.filter((it): it is LightboxItem => !!it && !!it.url)
  if (!clean.length) return
  state.items = clean
  state.index = Math.min(Math.max(startIndex, 0), clean.length - 1)
}

export function useLightbox() {
  const isOpen = computed(
    () => state.index >= 0 && state.index < state.items.length,
  )
  const current = computed<LightboxItem | null>(() =>
    isOpen.value ? state.items[state.index] : null,
  )
  const count = computed(() => state.items.length)
  const hasPrev = computed(() => isOpen.value && state.index > 0)
  const hasNext = computed(
    () => isOpen.value && state.index < state.items.length - 1,
  )

  function close(): void {
    state.index = -1
    state.items = []
  }
  function prev(): void {
    if (hasPrev.value) state.index -= 1
  }
  function next(): void {
    if (hasNext.value) state.index += 1
  }

  return {
    state,
    isOpen,
    current,
    count,
    hasPrev,
    hasNext,
    open: openLightbox,
    close,
    prev,
    next,
    index: computed(() => state.index),
  }
}
