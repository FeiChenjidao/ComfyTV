<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:size-full" @contextmenu.stop.prevent>
    <div
      class="ctv:shrink-0 ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1.5 ctv:px-1"
      @pointerdown.stop
      @wheel.stop
    >
      <div class="ctv:w-36 ctv:min-w-0">
        <ComfyTVSelect
          :model-value="ps.template()"
          :options="templateOptions"
          @update:model-value="ps.setTemplate(String($event))"
        />
      </div>
      <div class="ctv:w-40 ctv:min-w-0">
        <ComfyTVSelect
          :model-value="sizePresetLabel"
          :options="sizeOptions"
          @update:model-value="onSizePreset(String($event))"
        />
      </div>
      <label v-for="c in colorKeys" :key="c.key" :title="c.title"
             class="ctv:inline-flex ctv:items-center ctv:gap-1 ctv:cursor-pointer ctv:text-2xs ctv:text-muted-foreground">
        <span>{{ c.label }}</span>
        <input
          type="color"
          :value="ps.getColor(c.key)"
          class="ctv:w-5 ctv:h-4 ctv:p-0 ctv:border ctv:border-border-default ctv:rounded-sm ctv:bg-transparent ctv:cursor-pointer"
          @input="ps.setColor(c.key, ($event.target as HTMLInputElement).value)"
        >
      </label>
      <div class="ctv:w-32 ctv:min-w-0" :title="$t('poster.fontTitle')">
        <ComfyTVSelect
          :model-value="ps.getFont('font_title') || SYSTEM_FONT"
          :options="fontOptions"
          @update:model-value="onFont('font_title', String($event))"
        />
      </div>
      <div class="ctv:w-32 ctv:min-w-0" :title="$t('poster.fontBody')">
        <ComfyTVSelect
          :model-value="ps.getFont('font_body') || SYSTEM_FONT"
          :options="fontOptions"
          @update:model-value="onFont('font_body', String($event))"
        />
      </div>
      <span class="ctv:flex-1" />
      <button v-if="ps.hasElements.value" :class="btn(false)" :title="$t('poster.addTooltip')" @click="addMenuOpen = !addMenuOpen">➕</button>
      <button v-if="ps.hasElements.value" :class="btn(ps.gridOn.value)" :title="$t('poster.gridTooltip')" @click="ps.toggleGrid(); drawOverlay()">⌗</button>
      <button v-if="ps.hasElements.value" :class="btn(false)" :title="$t('poster.addGuideV')" @click="ps.addGuide('x'); ps.editMode.value = true; drawOverlay()">┊+</button>
      <button v-if="ps.hasElements.value" :class="btn(false)" :title="$t('poster.addGuideH')" @click="ps.addGuide('y'); ps.editMode.value = true; drawOverlay()">┄+</button>
      <button v-if="ps.hasElements.value" :class="btn(ps.snap.value)" :title="$t('poster.snapTooltip')" @click="ps.snap.value = !ps.snap.value">⊹</button>
      <button v-if="ps.hasElements.value" :class="btn(ps.editMode.value)" :title="$t('poster.editTooltip')" @click="toggleEdit">✎ {{ $t('poster.edit') }}</button>
    </div>

    <div
      v-if="addMenuOpen"
      class="ctv:shrink-0 ctv:flex ctv:items-center ctv:gap-1 ctv:px-1"
      @pointerdown.stop
    >
      <button v-for="t in addTypes" :key="t.type" :class="btn(false)"
              @click="onAdd(t.type)">{{ t.label }}</button>
    </div>

    <div
      ref="stageWrap"
      class="ctv:relative ctv:flex-1 ctv:min-h-0 ctv:overflow-hidden ctv:rounded-sm ctv:bg-black/40"
      tabindex="-1"
      @pointerdown.stop
      @wheel.stop
      @keydown="onKeydown"
    >
      <iframe ref="frameA" scrolling="no" :style="frameStyle(true)" />
      <iframe ref="frameB" scrolling="no" :style="frameStyle(false)" />
      <canvas
        ref="overlay"
        class="ctv:absolute ctv:z-[2]"
        :style="overlayStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="onDblClick"
      />

      <div
        v-if="toolbarVisible && activeRect"
        class="ctv:absolute ctv:z-[6] ctv:flex ctv:items-center ctv:gap-0.5 ctv:rounded-md ctv:border ctv:border-primary-background ctv:bg-interface-panel-surface ctv:px-1 ctv:py-0.5 ctv:whitespace-nowrap"
        :style="elToolbarStyle"
        @pointerdown.stop
      >
        <template v-if="activeType === 'text'">
          <button :class="miniBtn(false)" :title="$t('poster.fontToggle')" @click="toggleElFont">
            {{ elProp<string>('font', 'body') === 'title' ? $t('poster.fontTitleShort') : $t('poster.fontBodyShort') }}
          </button>
          <button :class="miniBtn(false)" @click="bumpFontSize(-2)">A−</button>
          <span class="ctv:text-2xs ctv:text-primary-foreground ctv:min-w-6 ctv:text-center">{{ Math.round(Number(elProp('font_size', 32))) }}</span>
          <button :class="miniBtn(false)" @click="bumpFontSize(2)">A+</button>
          <span :class="sepClass" />
          <button v-for="a in aligns" :key="a.v" :class="miniBtn(elProp('align', 'left') === a.v)"
                  @click="ps.setElementProp('align', a.v)">{{ a.l }}</button>
          <span :class="sepClass" />
          <button v-for="c in elColors" :key="c.v" :class="miniBtn(elProp('color', '') === c.v)"
                  @click="ps.setElementProp('color', c.v)">{{ c.l }}</button>
        </template>
        <template v-else-if="activeType === 'image'">
          <button :class="miniBtn(ps.imgEditId.value === activeId)" :title="$t('poster.imgAdjustTooltip')" @click="toggleImgEdit">✥</button>
          <input
            v-if="ps.imgEditId.value === activeId"
            type="range" min="1" max="4" step="0.02"
            class="ctv:w-20 ctv:cursor-pointer ctv:accent-primary-background"
            :value="imgScaleValue"
            @input="onImgScale(parseFloat(($event.target as HTMLInputElement).value))"
            @change="onImgScaleCommit"
          >
        </template>
        <span :class="sepClass" />
        <button :class="miniBtn(false) + ' ctv:text-destructive-foreground'" :title="$t('poster.deleteTooltip')" @click="ps.deleteActive()">🗑</button>
      </div>

      <div
        v-if="multiToolbarVisible && selectionRect"
        class="ctv:absolute ctv:z-[6] ctv:flex ctv:items-center ctv:gap-0.5 ctv:rounded-md ctv:border ctv:border-primary-background ctv:bg-interface-panel-surface ctv:px-1 ctv:py-0.5 ctv:whitespace-nowrap"
        :style="multiToolbarStyle"
        @pointerdown.stop
      >
        <button v-for="a in alignOps" :key="a.op" :class="miniBtn(false)"
                @click="onArrange(a.op)">{{ a.l }}</button>
        <span :class="sepClass" />
        <button v-for="d in distOps" :key="d.op"
                :class="miniBtn(false) + (ps.selectedIds.value.length < 3 && (d.op === 'hgap' || d.op === 'vgap') ? ' ctv:opacity-40' : '')"
                :disabled="ps.selectedIds.value.length < 3 && (d.op === 'hgap' || d.op === 'vgap')"
                @click="onArrange(d.op)">{{ d.l }}</button>
        <span :class="sepClass" />
        <button :class="miniBtn(false) + ' ctv:text-destructive-foreground'" :title="$t('poster.deleteTooltip')" @click="ps.deleteActive()">🗑</button>
      </div>

      <textarea
        v-if="inline"
        ref="inlineTa"
        v-model="inline.text"
        spellcheck="false"
        class="ctv:absolute ctv:z-[5] ctv:box-border ctv:resize-none ctv:rounded-sm ctv:border-2 ctv:border-primary-background ctv:bg-black/90 ctv:text-white ctv:text-xs ctv:font-mono ctv:p-1 ctv:overflow-auto ctv:focus-visible:outline-none"
        :style="inlineStyle"
        @pointerdown.stop
        @keydown="onInlineKeydown"
        @blur="closeInline(true)"
      />

      <div
        v-if="picker"
        class="ctv:absolute ctv:z-[7] ctv:flex ctv:flex-col ctv:rounded-md ctv:border ctv:border-border-default ctv:bg-interface-panel-surface ctv:p-1 ctv:min-w-28 ctv:max-h-56 ctv:overflow-y-auto"
        :style="{ left: picker.x + 'px', top: picker.y + 'px' }"
        @pointerdown.stop
      >
        <span class="ctv:text-3xs ctv:text-muted-foreground ctv:px-1.5 ctv:pb-1">{{ picker.title }}</span>
        <button
          v-for="opt in picker.options" :key="opt.key"
          :class="rowBtn(opt.active)"
          @click="opt.onPick(); picker = null"
        >{{ opt.label }}</button>
      </div>

      <div
        v-if="previewErrorText"
        class="ctv:absolute ctv:left-1 ctv:bottom-1 ctv:z-[3] ctv:text-2xs ctv:text-destructive-foreground ctv:bg-black/70 ctv:rounded-sm ctv:px-1.5 ctv:py-0.5"
      >{{ previewErrorText }}</div>
    </div>

    <div class="ctv:shrink-0">
      <StageCard
        :state="stageState"
        :node="node"
        :on-run-request="onRunRequest"
        :on-cancel-request="onCancelRequest"
        :on-disconnect="onDisconnect"
        :on-action="onAction"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import StageCard from '@/components/stages/StageCard.vue'
import ComfyTVSelect from '@/components/widgets/ComfyTVSelect.vue'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import { listResources } from '@/api'
import {
  SIZE_PRESETS, elementProp, rectPx, usePosterStage, type Rect,
} from '@/composables/stages/usePosterStage'
import * as opts from '@/composables/widgets/posterCardOptions'
import {
  SYSTEM_FONT, btn, miniBtn, rowBtn, sepClass,
} from '@/composables/widgets/posterCardOptions'
import { livePatchImg } from '@/composables/widgets/posterLivePatch'
import { drawPosterOverlay } from '@/composables/widgets/posterOverlay'
import { usePosterInlineEdit } from '@/composables/widgets/usePosterInlineEdit'
import { usePosterPointer } from '@/composables/widgets/usePosterPointer'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const { t } = useI18n()

const stageState = computed(() => props.state)
const ps = usePosterStage(props.node, () => props.state)

const stageWrap = ref<HTMLElement | null>(null)
const frameA = ref<HTMLIFrameElement | null>(null)
const frameB = ref<HTMLIFrameElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)

const frontIsA = ref(true)
const view = ref({ scale: 1, offX: 0, offY: 0, cw: 0, ch: 0 })
const addMenuOpen = ref(false)
const fonts = ref<string[]>([])

function drawOverlay() {
  const cv = overlay.value
  if (!cv) return
  drawPosterOverlay(cv, ps, pointer.marquee.value, t('poster.imgDragHint'))
}

const edit = usePosterInlineEdit({ ps, overlay, view, t, drawOverlay })
const { inline, inlineTa, picker, inlineStyle, closeInline, onInlineKeydown } = edit
const pointer = usePosterPointer({ ps, overlay, stageWrap, frontFrame, drawOverlay, edit })
const { onPointerDown, onPointerMove, onPointerUp, onDblClick, onKeydown } = pointer

const colorKeys = computed(() => opts.colorKeys(t))
const aligns = computed(() => opts.aligns(t))
const elColors = computed(() => opts.elColors(t))
const addTypes = computed(() => opts.addTypes(t))
const alignOps = computed(() => opts.alignOps(t))
const distOps = computed(() => opts.distOps(t))

const templateOptions = computed(() =>
  ps.templates.value.map(tp => ({ value: tp.name, label: tp.label || tp.name })))

const fontOptions = computed(() =>
  [SYSTEM_FONT, ...fonts.value].map(f => ({ value: f, label: f })))

const sizeTick = ref(0)
const sizeCustom = computed(() => {
  void sizeTick.value
  return `${t('poster.sizeCustom')} ${ps.posterWidth()}×${ps.posterHeight()}`
})
const sizePresetLabel = computed(() => {
  void sizeTick.value
  const w = ps.posterWidth()
  const h = ps.posterHeight()
  return SIZE_PRESETS.find(p => p.w === w && p.h === h)?.label ?? sizeCustom.value
})
const sizeOptions = computed(() => {
  const opts = SIZE_PRESETS.map(p => ({ value: p.label, label: p.label }))
  if (!SIZE_PRESETS.some(p => p.label === sizePresetLabel.value)) {
    opts.unshift({ value: sizeCustom.value, label: sizeCustom.value })
  }
  return opts
})

const previewErrorText = computed(() =>
  ps.previewError.value ? t('poster.previewFailed', { detail: ps.previewError.value }) : '')

const activeId = computed(() => ps.activeElement.value?.id ?? null)
const activeType = computed(() => ps.activeElement.value?.type ?? '')
const toolbarVisible = computed(() =>
  ps.editMode.value && ps.hasElements.value && !inline.value
  && ps.selectedIds.value.length === 1 && !!ps.activeElement.value)
const multiToolbarVisible = computed(() =>
  ps.editMode.value && ps.hasElements.value && !inline.value
  && ps.selectedIds.value.length >= 2)

const activeRect = computed<Rect | null>(() => {
  const el = ps.activeElement.value
  if (!el) return null
  return rectPx(ps.effRect(el), view.value.cw, view.value.ch)
})

const selectionRect = computed<Rect | null>(() => {
  const els = ps.selectedElements.value
  if (els.length < 2) return null
  const rects = els.map(el => rectPx(ps.effRect(el), view.value.cw, view.value.ch))
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
})

function floatingToolbarStyle(r: Rect | null, maxLeft: number) {
  if (!r) return {}
  const top = r.y + view.value.offY - 32
  return {
    left: `${Math.max(0, Math.min(r.x + view.value.offX, view.value.cw - maxLeft))}px`,
    top: `${top < 0 ? r.y + view.value.offY + r.h + 4 : top}px`,
  }
}

const multiToolbarStyle = computed(() => floatingToolbarStyle(selectionRect.value, 280))
const elToolbarStyle = computed(() => floatingToolbarStyle(activeRect.value, 180))

function onArrange(op: string) {
  ps.applyArrange(op as Parameters<typeof ps.applyArrange>[0])
  drawOverlay()
}

const imgScaleValue = computed(() => {
  const el = ps.activeElement.value
  return el ? ps.elementImageProps(el).scale : 1
})

const overlayStyle = computed(() => ({
  left: `${view.value.offX}px`,
  top: `${view.value.offY}px`,
  display: ps.editMode.value && ps.hasElements.value ? 'block' : 'none',
  touchAction: 'none',
}))

function elProp<T>(key: string, dflt: T): T {
  const el = ps.activeElement.value
  if (!el) return dflt
  return elementProp(el, ps.layout.value, key, dflt)
}

function frameStyle(isA: boolean) {
  const front = frontIsA.value === isA
  return {
    position: 'absolute' as const,
    left: `${view.value.offX}px`,
    top: `${view.value.offY}px`,
    width: `${ps.posterWidth()}px`,
    height: `${ps.posterHeight()}px`,
    border: '0',
    background: '#fff',
    transformOrigin: 'top left',
    transform: `scale(${view.value.scale})`,
    pointerEvents: 'none' as const,
    opacity: front ? '1' : '0',
  }
}

function frontFrame(): HTMLIFrameElement | null {
  return frontIsA.value ? frameA.value : frameB.value
}
function backFrame(): HTMLIFrameElement | null {
  return frontIsA.value ? frameB.value : frameA.value
}

let ro: ResizeObserver | null = null
function rescale() {
  const wrap = stageWrap.value
  if (!wrap) return
  const W = ps.posterWidth()
  const H = ps.posterHeight()
  const availW = Math.max(40, wrap.clientWidth)
  const availH = Math.max(40, wrap.clientHeight)
  const scale = Math.min(availW / W, availH / H)
  const cw = Math.round(W * scale)
  const ch = Math.max(1, Math.round(H * scale))
  view.value = {
    scale,
    offX: Math.floor((availW - cw) / 2),
    offY: Math.floor((availH - ch) / 2),
    cw, ch,
  }
  const cv = overlay.value
  if (cv) {
    cv.width = cw
    cv.height = ch
    cv.style.width = `${cw}px`
    cv.style.height = `${ch}px`
  }
  drawOverlay()
}

function toggleEdit() {
  ps.editMode.value = !ps.editMode.value
  drawOverlay()
}

function toggleImgEdit() {
  const el = ps.activeElement.value
  if (!el || el.type !== 'image') return
  ps.imgEditId.value = ps.imgEditId.value === el.id ? null : el.id
  drawOverlay()
}

function toggleElFont() {
  ps.setElementProp('font', elProp<string>('font', 'body') === 'title' ? 'body' : 'title')
}

function bumpFontSize(delta: number) {
  const cur = Math.round(Number(elProp('font_size', 32)))
  ps.setElementProp('font_size', Math.max(6, Math.min(400, cur + delta)))
}

function onImgScale(v: number) {
  const el = ps.activeElement.value
  if (!el) return
  ps.setImgScale(el, v)
  livePatchImg(frontFrame(), el.id, ps.elementImageProps(el))
}

function onImgScaleCommit() {
  ps.commitLayout()
  ps.scheduleRefresh(0)
}

function onAdd(type: string) {
  addMenuOpen.value = false
  ps.addElement(type)
  drawOverlay()
}

function onSizePreset(label: string) {
  ps.applySizePreset(label)
  sizeTick.value++
  void nextTick(rescale)
}

function onFont(key: 'font_title' | 'font_body', val: string) {
  ps.setFont(key, val === SYSTEM_FONT ? '' : val)
}

watch(() => ps.previewHtml.value + ps.refreshTick.value, () => {
  const back = backFrame()
  if (!back) return
  let done = false
  const finish = () => {
    if (done) return
    done = true
    back.removeEventListener('load', onLoad)
    frontIsA.value = !frontIsA.value
    rescale()
  }
  const onLoad = () => {
    requestAnimationFrame(() => requestAnimationFrame(finish))
  }
  back.addEventListener('load', onLoad)
  back.srcdoc = ps.previewHtml.value
  setTimeout(finish, 1500)
})

watch(() => [ps.editMode.value, ps.activeIdx.value, ps.selectedIds.value, ps.imgEditId.value, ps.elements.value], () => {
  drawOverlay()
}, { deep: false })

async function loadFonts() {
  try {
    const res = await listResources()
    fonts.value = (res.resources || [])
      .filter((r: any) => r.kind === 'font')
      .map((r: any) => String(r.filename))
  } catch {
    fonts.value = []
  }
}

onMounted(() => {
  ro = new ResizeObserver(rescale)
  if (stageWrap.value) ro.observe(stageWrap.value)
  rescale()
  void loadFonts()
  void ps.fetchTemplates()
  void ps.fetchElements()
  void ps.doRefresh()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})
</script>
