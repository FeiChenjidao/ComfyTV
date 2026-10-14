<template>
  <div
    class="ctv:absolute ctv:inset-x-0 ctv:bottom-0 ctv:z-10 ctv:flex ctv:flex-col ctv:gap-1
           ctv:p-1.5 ctv:pointer-events-none"
    @pointerdown.stop
    @mousedown.stop
  >
    <div class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1 ctv:pointer-events-auto">
      <button
        v-for="ch in channels"
        :key="ch"
        type="button"
        :class="chipClass(channel === ch)"
        @click.stop="emit('update:channel', ch)"
      >{{ $t(`meshOps.channel.${ch}`) }}</button>
      <span class="ctv:mx-0.5 ctv:h-3 ctv:w-px ctv:bg-white/25" />
      <button
        v-for="mode in lightings"
        :key="mode"
        type="button"
        :class="chipClass(lighting === mode)"
        :title="$t(`modelPreview.lighting.${mode}`)"
        @click.stop="emit('update:lighting', mode)"
      >{{ $t(`modelPreview.lighting.${mode}`) }}</button>
      <span class="ctv:mx-0.5 ctv:h-3 ctv:w-px ctv:bg-white/25" />
      <button
        type="button"
        :class="chipClass(!!hasTexture)"
        :title="$t('modelPreview.replaceTexture')"
        @click.stop="fileInput?.click()"
      >
        <i class="pi pi-image ctv:text-3xs" />
        {{ $t('modelPreview.replaceTexture') }}
      </button>
      <button
        v-if="hasTexture"
        type="button"
        :class="chipClass(false)"
        :title="$t('modelPreview.clearTexture')"
        @click.stop="emit('clear-texture')"
      ><i class="pi pi-times" /></button>
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        class="ctv:hidden"
        @change="onTexturePick"
      />
    </div>

    <div
      v-if="channel === 'material'"
      class="ctv:flex ctv:flex-col ctv:gap-0.5 ctv:rounded-sm ctv:bg-black/65 ctv:px-1.5 ctv:py-1
             ctv:pointer-events-auto ctv:backdrop-blur-sm"
    >
      <div class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:text-[11px]">
        <span class="ctv:min-w-14 ctv:shrink-0 ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-white/70">
          {{ $t('modelPreview.metalnessMul') }}
        </span>
        <input
          type="range" min="0" max="1" step="0.01"
          class="ctv:flex-1 ctv:accent-primary-background ctv:cursor-pointer"
          :value="metalness"
          @input="onMetalness"
        />
        <span class="ctv:w-8 ctv:text-right ctv:font-mono ctv:text-2xs ctv:text-white/80">
          {{ metalness.toFixed(2) }}
        </span>
      </div>
      <div class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:text-[11px]">
        <span class="ctv:min-w-14 ctv:shrink-0 ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-white/70">
          {{ $t('modelPreview.roughnessMul') }}
        </span>
        <input
          type="range" min="0" max="1" step="0.01"
          class="ctv:flex-1 ctv:accent-primary-background ctv:cursor-pointer"
          :value="roughness"
          @input="onRoughness"
        />
        <span class="ctv:w-8 ctv:text-right ctv:font-mono ctv:text-2xs ctv:text-white/80">
          {{ roughness.toFixed(2) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import {
  PREVIEW_CHANNELS,
  PREVIEW_LIGHTINGS,
  type PreviewLighting,
} from '@/widgets/three/previewShading'
import type { ViewChannel } from '@/widgets/three/channelShading'

defineProps<{
  channel: ViewChannel
  lighting: PreviewLighting
  metalness: number
  roughness: number
  hasTexture: boolean
}>()

const emit = defineEmits<{
  (e: 'update:channel', v: ViewChannel): void
  (e: 'update:lighting', v: PreviewLighting): void
  (e: 'update:metalness', v: number): void
  (e: 'update:roughness', v: number): void
  (e: 'texture-file', file: File): void
  (e: 'clear-texture'): void
}>()

const channels = PREVIEW_CHANNELS
const lightings = PREVIEW_LIGHTINGS
const fileInput = ref<HTMLInputElement | null>(null)

function chipClass(active: boolean): string {
  return 'ctv:inline-flex ctv:items-center ctv:gap-1 ctv:cursor-pointer ctv:[font-family:inherit]'
    + ' ctv:rounded-sm ctv:border ctv:px-1.5 ctv:py-0.5 ctv:text-2xs ctv:transition-colors'
    + (active
      ? ' ctv:border-primary-background ctv:bg-primary-background/30 ctv:text-white'
      : ' ctv:border-white/20 ctv:bg-black/55 ctv:text-white/75'
        + ' ctv:hover:bg-black/70 ctv:hover:text-white')
}

function onMetalness(e: Event) {
  emit('update:metalness', Number((e.target as HTMLInputElement).value))
}

function onRoughness(e: Event) {
  emit('update:roughness', Number((e.target as HTMLInputElement).value))
}

function onTexturePick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('texture-file', file)
}
</script>
