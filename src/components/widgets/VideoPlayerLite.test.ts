import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import VideoPlayerLite from './VideoPlayerLite.vue'

const proxy = vi.hoisted(() => ({ url: null as ReturnType<typeof ref<string | null>> | null }))

vi.mock('@/composables/widgets/useMidiRenderedUrl', () => ({
  isMidiUrl: () => false,
  useMidiRenderedUrl: (source: unknown) => ({ url: source }),
}))
vi.mock('@/composables/widgets/useProxiedVideoUrl', async () => {
  const { computed, ref } = await import('vue')
  return {
    useProxiedVideoUrl: (source: { value: string | null }) => ({
      url: computed(() => proxy.url?.value ?? source.value),
      isProxy: computed(() => proxy.url?.value != null),
      canProxy: ref(false), building: ref(false), pct: ref(0),
      requestProxy: vi.fn(),
    }),
  }
})
vi.mock('@/composables/widgets/useMidiPianoRoll', () => ({
  useMidiPianoRoll: () => ({ ready: ref(false) }),
}))
vi.mock('@/composables/widgets/useAudioWaveform', () => ({
  useAudioWaveform: () => ({ ready: ref(false) }),
}))

const wrappers: VueWrapper[] = []
const loopButton = (w: VueWrapper) => w.get('button[aria-label="videoTrim.loopPlayback"]')
const playButton = (w: VueWrapper) => w.get('button')

beforeEach(() => { proxy.url = ref<string | null>(null) })
afterEach(() => {
  for (const w of wrappers) w.unmount()
  wrappers.length = 0
})

function player(sourceVideoUrl: string | null = '/clip.mp4') {
  const w = mount(VideoPlayerLite, {
    props: { sourceVideoUrl, playbackRate: 1.5, volume: 0.4 },
    global: { mocks: { $t: (key: string) => key } },
  })
  wrappers.push(w)
  return w
}

async function loadVideo(w: VueWrapper) {
  const video = w.get('video').element as HTMLVideoElement
  let paused = true
  Object.defineProperties(video, {
    duration: { value: 3, configurable: true },
    videoWidth: { value: 320, configurable: true },
    videoHeight: { value: 180, configurable: true },
    paused: { get: () => paused, configurable: true },
  })
  video.play = vi.fn(async () => {
    paused = false
    video.dispatchEvent(new Event('play'))
  })
  video.pause = vi.fn(() => {
    paused = true
    video.dispatchEvent(new Event('pause'))
  })
  await w.get('video').trigger('loadedmetadata')
  return video
}

describe('VideoPlayerLite loop playback', () => {
  it('starts off and disables the switch until a usable video is loaded', async () => {
    const w = player()
    expect(loopButton(w).attributes('aria-pressed')).toBe('false')
    expect(loopButton(w).attributes('disabled')).toBeDefined()
    const video = await loadVideo(w)
    expect(video.loop).toBe(false)
    expect(loopButton(w).attributes('disabled')).toBeUndefined()
    await w.get('video').trigger('error')
    expect(loopButton(w).attributes('disabled')).toBeDefined()
    await w.setProps({ sourceVideoUrl: null })
    expect(w.find('video').exists()).toBe(false)
    expect(loopButton(w).attributes('disabled')).toBeDefined()
  })

  it('toggles loop and its highlight without changing playback, time, mute or tuning', async () => {
    const w = player()
    const video = await loadVideo(w)
    video.currentTime = 1.2
    await playButton(w).trigger('click')
    await loopButton(w).trigger('click')
    expect(video.loop).toBe(true)
    expect(loopButton(w).attributes('aria-pressed')).toBe('true')
    expect(loopButton(w).classes()).toContain('ctv:text-primary-background')
    expect(video.currentTime).toBe(1.2)
    expect(video.paused).toBe(false)
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(video.pause).not.toHaveBeenCalled()
    expect(video.muted).toBe(true)
    expect(video.playbackRate).toBe(1.5)
    expect(video.volume).toBe(0.4)
    await loopButton(w).trigger('click')
    expect(video.loop).toBe(false)
    expect(video.paused).toBe(false)
    expect(video.currentTime).toBe(1.2)
  })

  it('keeps loop selected when paused and resumes with the same setting', async () => {
    const w = player()
    const video = await loadVideo(w)
    await loopButton(w).trigger('click')
    await playButton(w).trigger('click')
    await playButton(w).trigger('click')
    expect(video.paused).toBe(true)
    expect(video.loop).toBe(true)
    expect(playButton(w).attributes('title')).toBe('videoCrop.play')
    await playButton(w).trigger('click')
    expect(video.paused).toBe(false)
    expect(video.loop).toBe(true)
  })

  it('isolates players and resets when the source changes or the player is reopened', async () => {
    const first = player()
    const second = player()
    await loadVideo(first)
    const secondVideo = await loadVideo(second)
    await loopButton(first).trigger('click')
    expect(secondVideo.loop).toBe(false)
    await first.setProps({ sourceVideoUrl: '/another.mp4' })
    expect(loopButton(first).attributes('aria-pressed')).toBe('false')
    expect((first.get('video').element as HTMLVideoElement).loop).toBe(false)
    await loadVideo(first)
    await loopButton(first).trigger('click')
    first.unmount()
    wrappers.splice(wrappers.indexOf(first), 1)
    const reopened = player('/another.mp4')
    expect(loopButton(reopened).attributes('aria-pressed')).toBe('false')
  })

  it('preserves loop across a proxy switch for the same original video', async () => {
    const w = player()
    await loadVideo(w)
    await loopButton(w).trigger('click')
    proxy.url!.value = '/proxy.mp4'
    await nextTick()
    expect(w.get('video').attributes('src')).toBe('/proxy.mp4')
    expect((w.get('video').element as HTMLVideoElement).loop).toBe(true)
    expect(loopButton(w).attributes('aria-pressed')).toBe('true')
  })

  it('restores the play button and final progress when non-looping playback ends', async () => {
    const w = player()
    const video = await loadVideo(w)
    await playButton(w).trigger('click')
    expect(playButton(w).attributes('title')).toBe('videoTrim.pause')
    video.currentTime = video.duration
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    await w.get('video').trigger('ended')
    expect(playButton(w).attributes('title')).toBe('videoCrop.play')
    expect(w.text()).toContain('0:03.0 / 0:03.0')
    expect(video.play).toHaveBeenCalledTimes(1)
  })
})
