<template>
  <div
    class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-full ctv:grow"
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
  >
    <div ref="containerEl"
         class="crop-canvas-backdrop ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-[340px] ctv:rounded-md ctv:overflow-hidden ctv:border ctv:border-border-subtle">
      <div v-if="!imageUrl"
           class="ctv:absolute ctv:inset-0 ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:text-white/50">
        <i class="pi pi-image ctv:text-[32px] ctv:opacity-60" />
        <div class="ctv:text-xs">{{ $t('imageCrop.noInputImage') }}</div>
      </div>

      <template v-else>
        <img
          ref="imageEl"
          :src="imageUrl"
          :alt="$t('imageCrop.cropPreviewAlt')"
          class="ctv:absolute ctv:inset-0 ctv:size-full ctv:object-contain ctv:pointer-events-none ctv:select-none"
          draggable="false"
          @load="onImageLoad"
          @error="handleImageError"
          @dragstart.prevent
        />

        <div v-if="isLoading"
             class="ctv:absolute ctv:inset-0 ctv:z-10 ctv:flex ctv:items-center ctv:justify-center ctv:text-xs
                    ctv:bg-black/90 ctv:text-white/85">
          {{ $t('imageCrop.loading') }}
        </div>

        <!-- Inactive boxes: border only -->
        <button
          v-for="box in inactiveBoxes"
          :key="box.id"
          type="button"
          class="crop-box crop-box--idle"
          :style="boxStyle(box)"
          :title="boxLabel(box)"
          @pointerdown.stop="emit('select', box.id)"
        >
          <span class="crop-box__tag">{{ boxIndex(box) }}</span>
        </button>

        <!-- Active box: dim overlay + drag/resize -->
        <div
          v-if="!isLoading && hasActive"
          class="crop-box crop-box--active"
          :style="cropBoxStyle"
          @pointerdown="handleDragStart"
          @pointermove="handleDragMove"
          @pointerup="handleDragEnd"
        >
          <span class="crop-box__tag">{{ activeIndex }}</span>
        </div>

        <div
          v-for="handle in resizeHandles"
          v-show="!isLoading && hasActive"
          :key="handle.direction"
          :class="['ctv:absolute', handle.isCorner ? 'ctv:bg-white/85 ctv:rounded-sm' : 'ctv:bg-transparent']"
          :style="{ ...handle.style, cursor: handle.cursor }"
          @pointerdown="(e) => handleResizeStart(e, handle.direction)"
          @pointermove="handleResizeMove"
          @pointerup="handleResizeEnd"
        />
      </template>
    </div>

    <div class="ctv:flex ctv:flex-col ctv:gap-1">
      <div class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:text-[11px]">
        <span class="ctv:min-w-9 ctv:text-2xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">{{ $t('imageCrop.ratio') }}</span>
        <div class="ctv-crop-select ctv:w-24 ctv:shrink-0">
          <ComfyTVSelect
            :model-value="selectedRatio"
            :options="ratioOptions"
            :filterable="false"
            @update:model-value="(v) => (selectedRatio = String(v))"
          />
        </div>
        <button
          type="button"
          :class="[
            'ctv:w-7 ctv:h-6 ctv:text-xs ctv:rounded ctv:cursor-pointer ctv:border',
            isLockEnabled
              ? 'ctv:bg-secondary-background-selected ctv:border-primary-background ctv:text-primary-background'
              : 'ctv:bg-secondary-background ctv:border-border-subtle ctv:text-base-foreground',
          ]"
          :title="isLockEnabled ? $t('imageCrop.unlockRatio') : $t('imageCrop.lockRatio')"
          @click="isLockEnabled = !isLockEnabled"
        ><i :class="['pi', isLockEnabled ? 'pi-lock' : 'pi-lock-open']" /></button>

        <span class="ctv:flex-1" />
        <button
          type="button"
          class="ctv:h-6 ctv:px-2 ctv:text-[11px] ctv:rounded ctv:border ctv:border-border-subtle
                 ctv:bg-secondary-background ctv:text-base-foreground ctv:disabled:opacity-40"
          :disabled="!canAdd"
          :title="$t('imageCrop.addBox')"
          @click="onAdd"
        >{{ $t('imageCrop.addBox') }}</button>
        <button
          type="button"
          class="ctv:h-6 ctv:px-2 ctv:text-[11px] ctv:rounded ctv:border ctv:border-border-subtle
                 ctv:bg-secondary-background ctv:text-base-foreground ctv:disabled:opacity-40"
          :disabled="!canRemove"
          :title="$t('imageCrop.removeBox')"
          @click="emit('remove')"
        >{{ $t('imageCrop.removeBox') }}</button>
      </div>

      <div class="ctv:flex ctv:items-center ctv:gap-1 ctv:text-[11px]">
        <label v-for="b in BOUND_FIELDS" :key="b.label"
               class="ctv:flex-1 ctv:flex ctv:items-center ctv:gap-1 ctv:py-0.5 ctv:px-1 ctv:rounded
                      ctv:bg-secondary-background ctv:border ctv:border-border-subtle">
          <span class="ctv:w-3 ctv:text-2xs ctv:text-muted-foreground">{{ b.label }}</span>
          <input
            type="number"
            :min="b.min" step="1"
            class="ctv-bound-input ctv:w-full ctv:border-0 ctv:outline-none ctv:bg-transparent ctv:text-[11px] ctv:font-mono ctv:text-base-foreground"
            :value="boundFieldValue(b)"
            @change="(e) => boundFieldSet(b, (e.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import {
  ASPECT_RATIOS,
  useImageCrop,
  type Bounds,
} from '@/composables/widgets/useImageCrop'
import type { CropBox } from '@/composables/stages/useCropStage'

const props = withDefaults(defineProps<{
  sourceImageUrl: string | null
  bounds: Bounds
  boxes?: CropBox[]
  selectedId?: string
  canAdd?: boolean
  canRemove?: boolean
}>(), {
  boxes: () => [],
  selectedId: '',
  canAdd: true,
  canRemove: false,
})

const emit = defineEmits<{
  'update:bounds': [v: Bounds]
  select: [id: string]
  add: [natW: number, natH: number]
  remove: []
}>()

const imageEl = ref<HTMLImageElement | null>(null)
const containerEl = ref<HTMLDivElement | null>(null)

const boundsRef = ref<Bounds>({ ...props.bounds })
function syncFromProp() { boundsRef.value = { ...props.bounds } }
watch(() => props.bounds, syncFromProp, { deep: true })
watch(boundsRef, (v) => {
  if (
    v.x !== props.bounds.x ||
    v.y !== props.bounds.y ||
    v.width !== props.bounds.width ||
    v.height !== props.bounds.height
  ) {
    emit('update:bounds', { ...v })
  }
}, { deep: true })

const sourceImageUrlRef = computed(() => props.sourceImageUrl)

const {
  imageUrl, isLoading,
  naturalWidth, naturalHeight,
  scaleFactor, imageOffsetX, imageOffsetY,
  cropX, cropY, cropWidth, cropHeight,
  selectedRatio, isLockEnabled,
  cropBoxStyle, resizeHandles,
  handleImageLoad, handleImageError,
  handleDragStart, handleDragMove, handleDragEnd,
  handleResizeStart, handleResizeMove, handleResizeEnd,
} = useImageCrop({
  imageEl,
  containerEl,
  sourceImageUrl: sourceImageUrlRef,
  modelValue: boundsRef,
})

const hasActive = computed(() =>
  props.bounds.width > 0 && props.bounds.height > 0)

const inactiveBoxes = computed(() =>
  (props.boxes ?? []).filter(b => b.id !== props.selectedId && b.width > 0 && b.height > 0))

const activeIndex = computed(() => {
  const i = (props.boxes ?? []).findIndex(b => b.id === props.selectedId)
  return i >= 0 ? i + 1 : 1
})

function boxIndex(box: CropBox): number {
  const i = (props.boxes ?? []).findIndex(b => b.id === box.id)
  return i >= 0 ? i + 1 : 0
}

function boxLabel(box: CropBox): string {
  return `Crop ${boxIndex(box)}`
}

function boxStyle(box: CropBox): Record<string, string> {
  const s = scaleFactor.value
  return {
    left: `${imageOffsetX.value + box.x * s - 2}px`,
    top: `${imageOffsetY.value + box.y * s - 2}px`,
    width: `${box.width * s}px`,
    height: `${box.height * s}px`,
  }
}

function onImageLoad() {
  handleImageLoad()
}

function onAdd() {
  emit('add', naturalWidth.value, naturalHeight.value)
}

const { t } = useI18n()
const ratioOptions = Object.keys(ASPECT_RATIOS).map((key) => ({
  value: key,
  label: key === 'custom' ? t('imageCrop.custom') : key,
}))

function clampInt(raw: string, min = 0): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.round(n))
}

type BoundField = { label: 'X' | 'Y' | 'W' | 'H'; min: number }
const BOUND_FIELDS: BoundField[] = [
  { label: 'X', min: 0 },
  { label: 'Y', min: 0 },
  { label: 'W', min: 16 },
  { label: 'H', min: 16 },
]
function boundFieldValue(b: BoundField): number {
  return b.label === 'X' ? cropX.value
    : b.label === 'Y' ? cropY.value
    : b.label === 'W' ? cropWidth.value
    : cropHeight.value
}
function boundFieldSet(b: BoundField, raw: string) {
  const v = clampInt(raw, b.min)
  if (b.label === 'X') cropX.value = v
  else if (b.label === 'Y') cropY.value = v
  else if (b.label === 'W') cropWidth.value = v
  else cropHeight.value = v
}
</script>

<style scoped>
.crop-canvas-backdrop {
  background: var(--v2-checker, #1d1d22 repeating-conic-gradient(#25252b 0% 25%, #1d1d22 0% 50%));
  background-size: 18px 18px;
}
.crop-box {
  position: absolute;
  box-sizing: content-box;
  border: 2px solid #fff;
  user-select: none;
}
.crop-box--active {
  cursor: move;
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.5);
  z-index: 2;
}
.crop-box--idle {
  cursor: pointer;
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.75);
  background: transparent;
  padding: 0;
  z-index: 1;
}
.crop-box--idle:hover { border-color: #fff; background: rgb(255 255 255 / 0.06); }
.crop-box__tag {
  position: absolute;
  top: -2px;
  left: -2px;
  min-width: 16px;
  padding: 1px 4px;
  border-radius: 0 0 4px 0;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font: 600 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
}
.ctv-crop-select :deep(button) {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  border-radius: 6px;
  border-width: 1px;
}
.ctv-bound-input { -moz-appearance: textfield; }
.ctv-bound-input::-webkit-inner-spin-button,
.ctv-bound-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
}
</style>
