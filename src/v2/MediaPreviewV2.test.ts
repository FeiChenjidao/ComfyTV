import { createTestingPinia } from '@pinia/testing'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

import { makeI18n } from '@/__tests__/renderHelpers'
import { app } from '@/lib/comfyApp'

import MediaPreviewV2 from './MediaPreviewV2.vue'

enableAutoUnmount(afterEach)

function mountPreview(
  props: InstanceType<typeof MediaPreviewV2>['$props'],
  stubs: Record<string, Component | boolean> = {},
) {
  return mount(MediaPreviewV2, {
    props,
    global: {
      plugins: [makeI18n(), createTestingPinia({ stubActions: false })],
      stubs,
    },
  })
}

describe('MediaPreviewV2', () => {
  it('plays video previews with sound', () => {
    ;(app as any).api.apiURL = (p: string) => p
    const wrapper = mountPreview(
      { kind: 'video', url: '/view?filename=clip.mp4&type=output', hint: '' },
      { ProxiedVideo: { template: '<video v-bind="$attrs" />' } },
    )
    const video = wrapper.find('video').element as HTMLVideoElement
    expect(video.controls).toBe(true)
    expect(video.muted).toBe(false)
  })

  it('plays the first video from a batch payload and shows the count', () => {
    ;(app as any).api.apiURL = (p: string) => p
    const batch = JSON.stringify({
      images: [
        { image_url: '/view?filename=a.mp4&type=output' },
        { image_url: '/view?filename=b.mp4&type=output' },
      ],
    })
    const wrapper = mountPreview(
      { kind: 'video', url: batch, hint: '' },
      { ProxiedVideo: { template: '<video v-bind="$attrs" />' } },
    )

    expect(wrapper.find('video').attributes('src'))
      .toBe('/view?filename=a.mp4&type=output')
    expect(wrapper.find('.v2-mp__count').text()).toBe('2')
  })

  it('shows a loop switch below the native video controls', async () => {
    ;(app as any).api.apiURL = (p: string) => p
    const wrapper = mountPreview(
      { kind: 'video', url: '/view?filename=clip.mp4&type=output', hint: '' },
      { ProxiedVideo: { template: '<video v-bind="$attrs" />' } },
    )
    const video = wrapper.get('video').element as HTMLVideoElement
    const play = vi.spyOn(video, 'play')
    const pause = vi.spyOn(video, 'pause')
    video.currentTime = 1.2
    const button = wrapper.get('button[aria-label="Loop playback"]')
    expect(video.loop).toBe(false)
    expect(button.attributes('aria-pressed')).toBe('false')
    await button.trigger('click')
    expect(video.loop).toBe(true)
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.v2-mp__videocontrols').exists()).toBe(true)
    expect(video.currentTime).toBe(1.2)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    await button.trigger('click')
    expect(video.loop).toBe(false)
  })

  it('resets loop when the selected video changes', async () => {
    ;(app as any).api.apiURL = (p: string) => p
    const wrapper = mountPreview(
      { kind: 'video', url: '/first.mp4', hint: '' },
      { ProxiedVideo: { template: '<video v-bind="$attrs" />' } },
    )
    await wrapper.get('.v2-mp__loop').trigger('click')
    await wrapper.setProps({ url: '/second.mp4' })
    expect(wrapper.get('.v2-mp__loop').attributes('aria-pressed')).toBe('false')
    expect((wrapper.get('video').element as HTMLVideoElement).loop).toBe(false)
  })

  it('keeps video previews independent and resets after a preview is reopened', async () => {
    ;(app as any).api.apiURL = (p: string) => p
    const stubs = { ProxiedVideo: { template: '<video v-bind="$attrs" />' } }
    const first = mountPreview({ kind: 'video', url: '/clip.mp4', hint: '' }, stubs)
    const second = mountPreview({ kind: 'video', url: '/clip.mp4', hint: '' }, stubs)
    await first.get('.v2-mp__loop').trigger('click')
    expect((second.get('video').element as HTMLVideoElement).loop).toBe(false)
    await first.setProps({ url: null })
    expect(first.find('.v2-mp__loop').exists()).toBe(false)
    await first.setProps({ url: '/clip.mp4' })
    expect((first.get('video').element as HTMLVideoElement).loop).toBe(false)
  })

  it('does not add loop controls to non-video or empty previews', () => {
    ;(app as any).api.apiURL = (p: string) => p
    expect(mountPreview({ kind: 'text', text: 'test', hint: '' }).find('.v2-mp__loop').exists()).toBe(false)
    expect(mountPreview({ kind: 'video', url: null, hint: '' }).find('.v2-mp__loop').exists()).toBe(false)
  })

  it('shows model history as prev/next pager at the top', async () => {
    const onPickIndex = vi.fn()
    const poolJson = JSON.stringify({
      images: [
        { index: '1', image_url: '/view?filename=a.glb' },
        { index: '2', image_url: '/view?filename=b.glb' },
        { index: '3', image_url: '/view?filename=c.glb' },
      ],
    })
    const wrapper = mountPreview(
      {
        kind: 'model',
        url: '/view?filename=a.glb',
        hint: '',
        poolJson,
        pickedIndex: 1,
        onPickIndex,
      },
      {
        ModelPreview: { template: '<div class="stub-model" />' },
        Teleport: true,
      },
    )
    expect(wrapper.find('.v2-mp__hist').exists()).toBe(true)
    expect(wrapper.find('.v2-mp__histn').text()).toBe('1/3')
    const navs = wrapper.findAll('.v2-mp__histnav')
    expect(navs).toHaveLength(2)
    expect((navs[0].element as HTMLButtonElement).disabled).toBe(true)
    await navs[1].trigger('click')
    expect(onPickIndex).toHaveBeenCalledWith(2)
  })
})
