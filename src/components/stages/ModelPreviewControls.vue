<template>
  <div
    class="ctv:absolute ctv:inset-0 ctv:z-10 ctv:pointer-events-none ctv:text-white"
    @pointerdown.stop
    @mousedown.stop
  >
    <div
      class="ctv:absolute ctv:left-1/2 ctv:bottom-2 ctv:flex ctv:max-w-[calc(100%-16px)] ctv:-translate-x-1/2
             ctv:items-center ctv:gap-0.5 ctv:rounded-md ctv:border ctv:border-white/15 ctv:bg-black/75 ctv:p-1
             ctv:shadow-lg ctv:backdrop-blur-md ctv:pointer-events-auto"
    >
      <button
        v-for="item in channelItems"
        :key="item.key"
        type="button"
        :class="toolClass(channel === item.key)"
        :title="$t(`meshOps.channel.${item.key}`)"
        @click.stop="emit('update:channel', item.key)"
      >
        <component :is="item.icon" class="ctv:size-3.5 ctv:shrink-0" />
        <span class="ctv:hidden ctv:min-[430px]:inline">{{ $t(`meshOps.channel.${item.key}`) }}</span>
      </button>

      <span class="ctv:mx-0.5 ctv:h-5 ctv:w-px ctv:bg-white/15" />

      <button
        type="button"
        :class="toolClass(panelOpen && panelTab !== 'info')"
        :title="$t('modelPreview.materialEditor')"
        @click.stop="togglePanel('maps')"
      ><IconSlidersHorizontal class="ctv:size-3.5" /></button>
      <button
        type="button"
        :class="toolClass(panelOpen && panelTab === 'info')"
        :title="$t('modelPreview.modelInfo')"
        @click.stop="togglePanel('info')"
      ><IconInfo class="ctv:size-3.5" /></button>
      <button
        type="button"
        :class="toolClass(false)"
        :title="$t('modelPreview.resetView')"
        @click.stop="emit('reset-view')"
      ><IconRotateCcw class="ctv:size-3.5" /></button>
      <button
        type="button"
        :class="toolClass(fullscreen)"
        :title="$t(fullscreen ? 'modelPreview.exitFullscreen' : 'modelPreview.fullscreen')"
        @click.stop="emit('toggle-fullscreen')"
      >
        <IconMinimize2 v-if="fullscreen" class="ctv:size-3.5" />
        <IconMaximize2 v-else class="ctv:size-3.5" />
      </button>
    </div>

    <aside
      v-if="panelOpen"
      class="ctv:absolute ctv:top-9 ctv:right-2 ctv:bottom-12 ctv:flex ctv:w-[min(292px,calc(100%-16px))]
             ctv:min-h-0 ctv:flex-col ctv:overflow-hidden ctv:rounded-md ctv:border ctv:border-white/15
             ctv:bg-[#151619]/95 ctv:shadow-2xl ctv:backdrop-blur-md ctv:pointer-events-auto"
      @pointermove.stop
      @pointerup.stop
      @wheel.stop
    >
      <header class="ctv:flex ctv:shrink-0 ctv:items-center ctv:gap-1 ctv:border-b ctv:border-white/10 ctv:px-2 ctv:py-1.5">
        <IconBox class="ctv:size-3.5 ctv:text-[#b8ef45]" />
        <strong class="ctv:min-w-0 ctv:flex-1 ctv:truncate ctv:text-[11px] ctv:font-medium">
          {{ $t(panelTab === 'info' ? 'modelPreview.modelInfo' : 'modelPreview.materialEditor') }}
        </strong>
        <button type="button" :class="iconClass" :title="$t('modelPreview.closePanel')" @click.stop="panelOpen = false">
          <IconX class="ctv:size-3.5" />
        </button>
      </header>

      <nav class="ctv:flex ctv:shrink-0 ctv:border-b ctv:border-white/10 ctv:p-1">
        <button
          v-for="tab in panelTabs"
          :key="tab.key"
          type="button"
          :class="tabClass(panelTab === tab.key)"
          @click.stop="panelTab = tab.key"
        >
          <component :is="tab.icon" class="ctv:size-3" />
          {{ $t(`modelPreview.tab.${tab.key}`) }}
        </button>
      </nav>

      <div class="ctv:min-h-0 ctv:flex-1 ctv:overflow-y-auto ctv:p-2">
        <template v-if="panelTab === 'maps'">
          <div class="ctv:mb-2 ctv:grid ctv:grid-cols-[88px_minmax(0,1fr)] ctv:gap-2">
            <button
              type="button"
              class="ctv:relative ctv:flex ctv:aspect-square ctv:items-center ctv:justify-center ctv:overflow-hidden
                     ctv:rounded-md ctv:border ctv:border-white/12 ctv:bg-[repeating-conic-gradient(#292b30_0_25%,#202126_0_50%)_0_0/14px_14px]"
              :title="$t('modelPreview.replaceMap')"
              @click.stop="selectedMap && pickMap(selectedMap.key)"
            >
              <img
                v-if="selectedMap?.previewUrl"
                :src="selectedMap.previewUrl"
                class="ctv:h-full ctv:w-full ctv:object-contain"
                draggable="false"
              />
              <IconImage v-else class="ctv:size-6 ctv:text-white/25" />
            </button>
            <div class="ctv:min-w-0 ctv:self-center">
              <div class="ctv:truncate ctv:text-xs ctv:font-medium">
                {{ selectedMap ? $t(`materialStage.mapSlot.${selectedMap.key}`) : '' }}
              </div>
              <div class="ctv:mt-0.5 ctv:text-2xs ctv:text-white/45">
                {{ selectedMap ? mapStatus(selectedMap) : '' }}
              </div>
              <div class="ctv:mt-2 ctv:flex ctv:gap-1">
                <button type="button" :class="smallButtonClass" @click.stop="selectedMap && pickMap(selectedMap.key)">
                  <IconUpload class="ctv:size-3" /> {{ $t('modelPreview.replaceMap') }}
                </button>
                <button
                  v-if="selectedMap?.source === 'custom'"
                  type="button"
                  :class="smallButtonClass"
                  @click.stop="emit('clear-map', selectedMap.key)"
                ><IconUndo2 class="ctv:size-3" /> {{ $t('modelPreview.restoreMap') }}</button>
              </div>
            </div>
          </div>

          <div class="ctv:grid ctv:grid-cols-2 ctv:gap-1.5">
            <button
              v-for="slot in mapSlots"
              :key="slot.key"
              type="button"
              :class="mapSlotClass(selectedMapKey === slot.key, slot.source)"
              @click.stop="selectedMapKey = slot.key"
            >
              <span
                class="ctv:flex ctv:size-9 ctv:shrink-0 ctv:items-center ctv:justify-center ctv:overflow-hidden ctv:rounded
                       ctv:bg-[repeating-conic-gradient(#303238_0_25%,#24262b_0_50%)_0_0/10px_10px]"
              >
                <img v-if="slot.previewUrl" :src="slot.previewUrl" class="ctv:h-full ctv:w-full ctv:object-cover" draggable="false" />
                <IconImage v-else class="ctv:size-3.5 ctv:text-white/20" />
              </span>
              <span class="ctv:min-w-0 ctv:flex-1 ctv:text-left">
                <span class="ctv:block ctv:truncate ctv:text-[10px] ctv:leading-tight">
                  {{ $t(`materialStage.mapSlot.${slot.key}`) }}
                </span>
                <span class="ctv:mt-0.5 ctv:block ctv:truncate ctv:text-[9px] ctv:text-white/40">
                  {{ mapStatus(slot) }}
                </span>
              </span>
              <IconCircleCheck v-if="slot.source === 'custom'" class="ctv:size-3 ctv:text-[#b8ef45]" />
            </button>
          </div>
        </template>

        <template v-else-if="panelTab === 'pbr'">
          <section class="ctv:mb-3">
            <div class="ctv:mb-1.5 ctv:text-2xs ctv:font-medium ctv:text-white/65">
              {{ $t('modelPreview.lightingTitle') }}
            </div>
            <div class="ctv:grid ctv:grid-cols-4 ctv:gap-1">
              <button
                v-for="mode in lightings"
                :key="mode"
                type="button"
                :class="segmentClass(lighting === mode)"
                @click.stop="emit('update:lighting', mode)"
              >{{ $t(`modelPreview.lighting.${mode}`) }}</button>
            </div>
          </section>

          <section>
            <div class="ctv:mb-1.5 ctv:flex ctv:items-center ctv:justify-between">
              <span class="ctv:text-2xs ctv:font-medium ctv:text-white/65">{{ $t('modelPreview.pbrStrength') }}</span>
              <button type="button" :class="smallButtonClass" @click.stop="emit('reset-pbr')">
                <IconRotateCcw class="ctv:size-3" /> {{ $t('modelPreview.reset') }}
              </button>
            </div>
            <label v-for="key in pbrKeys" :key="key" class="ctv:mb-2 ctv:block">
              <span class="ctv:mb-0.5 ctv:flex ctv:items-center ctv:justify-between ctv:text-[10px]">
                <span class="ctv:text-white/70">{{ $t(`materialStage.param.${key}`) }}</span>
                <span class="ctv:font-mono ctv:text-white/50">{{ pbr[key].toFixed(2) }}×</span>
              </span>
              <input
                type="range"
                class="ctv:block ctv:h-3 ctv:w-full ctv:cursor-pointer ctv:accent-[#b8ef45]"
                :min="pbrRanges[key].min"
                :max="pbrRanges[key].max"
                :step="pbrRanges[key].step"
                :value="pbr[key]"
                @input="onPbrInput(key, $event)"
              />
            </label>
          </section>
        </template>

        <template v-else>
          <div class="ctv:grid ctv:grid-cols-2 ctv:gap-px ctv:overflow-hidden ctv:rounded-md ctv:border ctv:border-white/10 ctv:bg-white/10">
            <div v-for="item in statItems" :key="item.label" class="ctv:bg-[#181a1e] ctv:p-2">
              <div class="ctv:text-[9px] ctv:uppercase ctv:text-white/40">{{ item.label }}</div>
              <div class="ctv:mt-0.5 ctv:truncate ctv:font-mono ctv:text-xs ctv:text-white/85">{{ item.value }}</div>
            </div>
          </div>
          <div class="ctv:mt-3 ctv:text-2xs ctv:leading-relaxed ctv:text-white/45">
            {{ $t('modelPreview.navigationHint') }}
          </div>
        </template>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        class="ctv:hidden"
        @change="onTexturePick"
      />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import IconBox from '~icons/lucide/box'
import IconCircleCheck from '~icons/lucide/circle-check'
import IconCompass from '~icons/lucide/compass'
import IconGrid3X3 from '~icons/lucide/grid-3x3'
import IconImage from '~icons/lucide/image'
import IconImages from '~icons/lucide/images'
import IconInfo from '~icons/lucide/info'
import IconMaximize2 from '~icons/lucide/maximize-2'
import IconMinimize2 from '~icons/lucide/minimize-2'
import IconPalette from '~icons/lucide/palette'
import IconRotateCcw from '~icons/lucide/rotate-ccw'
import IconSlidersHorizontal from '~icons/lucide/sliders-horizontal'
import IconUndo2 from '~icons/lucide/undo-2'
import IconUpload from '~icons/lucide/upload'
import IconX from '~icons/lucide/x'

import {
  PREVIEW_PBR_RANGES,
  type ModelViewerStats,
  type PreviewMapSlot,
  type PreviewPbrKey,
  type PreviewPbrState,
} from './modelPreviewTypes'
import { PREVIEW_LIGHTINGS, type PreviewLighting } from '@/widgets/three/previewShading'
import type { MaterialMapKey } from '@/widgets/material/types'
import type { ViewChannel } from '@/widgets/three/channelShading'

const props = defineProps<{
  channel: ViewChannel
  lighting: PreviewLighting
  pbr: PreviewPbrState
  mapSlots: PreviewMapSlot[]
  stats: ModelViewerStats
  fullscreen: boolean
}>()

const emit = defineEmits<{
  (e: 'update:channel', value: ViewChannel): void
  (e: 'update:lighting', value: PreviewLighting): void
  (e: 'update:pbr', key: PreviewPbrKey, value: number): void
  (e: 'reset-pbr'): void
  (e: 'map-file', key: MaterialMapKey, file: File): void
  (e: 'clear-map', key: MaterialMapKey): void
  (e: 'reset-view'): void
  (e: 'toggle-fullscreen'): void
}>()

const { t } = useI18n()
const lightings = PREVIEW_LIGHTINGS
const pbrRanges = PREVIEW_PBR_RANGES
const pbrKeys = Object.keys(PREVIEW_PBR_RANGES) as PreviewPbrKey[]
const channelItems: { key: ViewChannel; icon: Component }[] = [
  { key: 'material', icon: IconPalette },
  { key: 'clay', icon: IconBox },
  { key: 'wire', icon: IconGrid3X3 },
  { key: 'normal', icon: IconCompass },
]
const panelTabs = [
  { key: 'maps' as const, icon: IconImages },
  { key: 'pbr' as const, icon: IconSlidersHorizontal },
  { key: 'info' as const, icon: IconInfo },
]

const panelOpen = ref(false)
const panelTab = ref<'maps' | 'pbr' | 'info'>('maps')
const selectedMapKey = ref<MaterialMapKey>('map')
const pendingMapKey = ref<MaterialMapKey>('map')
const fileInput = ref<HTMLInputElement | null>(null)

const selectedMap = computed(() =>
  props.mapSlots.find((slot) => slot.key === selectedMapKey.value) ?? props.mapSlots[0],
)

const statItems = computed(() => [
  { label: t('modelPreview.stats.triangles'), value: formatCount(props.stats.triangles) },
  { label: t('modelPreview.stats.vertices'), value: formatCount(props.stats.vertices) },
  { label: t('modelPreview.stats.meshes'), value: String(props.stats.meshes) },
  { label: t('modelPreview.stats.materials'), value: String(props.stats.materials) },
  { label: t('modelPreview.stats.dimensions'), value: props.stats.size.map(formatDimension).join(' × ') },
  { label: t('modelPreview.stats.textureSlots'), value: String(props.mapSlots.filter((slot) => slot.source !== 'empty').length) },
])

function togglePanel(tab: 'maps' | 'info'): void {
  if (panelOpen.value && panelTab.value === tab) {
    panelOpen.value = false
    return
  }
  panelTab.value = tab
  panelOpen.value = true
}

function pickMap(key: MaterialMapKey): void {
  pendingMapKey.value = key
  fileInput.value?.click()
}

function onTexturePick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('map-file', pendingMapKey.value, file)
}

function onPbrInput(key: PreviewPbrKey, event: Event): void {
  emit('update:pbr', key, Number((event.target as HTMLInputElement).value))
}

function mapStatus(slot: PreviewMapSlot): string {
  if (slot.source === 'custom') return slot.fileName || t('modelPreview.mapSource.custom')
  if (slot.source === 'embedded') {
    return t('modelPreview.mapSource.embedded', { count: slot.count })
  }
  return t('modelPreview.mapSource.empty')
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)
}

function toolClass(active: boolean): string {
  return 'ctv:inline-flex ctv:h-7 ctv:min-w-7 ctv:items-center ctv:justify-center ctv:gap-1 ctv:rounded ctv:border-none'
    + ' ctv:px-1.5 ctv:text-[10px] ctv:cursor-pointer ctv:transition-colors'
    + (active
      ? ' ctv:bg-[#b8ef45] ctv:text-black'
      : ' ctv:bg-transparent ctv:text-white/70 ctv:hover:bg-white/10 ctv:hover:text-white')
}

function tabClass(active: boolean): string {
  return 'ctv:flex ctv:h-7 ctv:flex-1 ctv:items-center ctv:justify-center ctv:gap-1 ctv:rounded ctv:border-none'
    + ' ctv:text-[10px] ctv:cursor-pointer ctv:transition-colors'
    + (active ? ' ctv:bg-white/12 ctv:text-white' : ' ctv:bg-transparent ctv:text-white/45 ctv:hover:text-white/80')
}

function mapSlotClass(active: boolean, source: PreviewMapSlot['source']): string {
  return 'ctv:flex ctv:min-w-0 ctv:items-center ctv:gap-1.5 ctv:rounded-md ctv:border ctv:p-1 ctv:cursor-pointer ctv:transition-colors'
    + (active
      ? ' ctv:border-[#b8ef45]/70 ctv:bg-[#b8ef45]/10'
      : ' ctv:border-white/10 ctv:bg-white/[0.03] ctv:hover:bg-white/[0.07]')
    + (source === 'empty' ? ' ctv:text-white/45' : ' ctv:text-white/85')
}

function segmentClass(active: boolean): string {
  return 'ctv:h-7 ctv:rounded ctv:border ctv:text-[9px] ctv:cursor-pointer'
    + (active
      ? ' ctv:border-[#b8ef45]/60 ctv:bg-[#b8ef45]/15 ctv:text-white'
      : ' ctv:border-white/10 ctv:bg-white/[0.03] ctv:text-white/50 ctv:hover:text-white/80')
}

const iconClass = 'ctv:flex ctv:size-6 ctv:items-center ctv:justify-center ctv:rounded ctv:border-none ctv:bg-transparent ctv:text-white/50 ctv:cursor-pointer ctv:hover:bg-white/10 ctv:hover:text-white'
const smallButtonClass = 'ctv:inline-flex ctv:h-6 ctv:items-center ctv:gap-1 ctv:rounded ctv:border ctv:border-white/10 ctv:bg-white/[0.04] ctv:px-1.5 ctv:text-[9px] ctv:text-white/65 ctv:cursor-pointer ctv:hover:bg-white/10 ctv:hover:text-white'
</script>
