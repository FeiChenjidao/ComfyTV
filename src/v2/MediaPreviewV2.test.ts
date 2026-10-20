import { createTestingPinia } from '@pinia/testing'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { makeI18n } from '@/__tests__/renderHelpers'
import { app } from '@/lib/comfyApp'

import MediaPreviewV2 from './MediaPreviewV2.vue'

function mountPreview(props: Record<string, unknown>, stubs: Record<string, unknown> = {}) {
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
