<template>
  <div
    :class="[
      'ctv:flex ctv:flex-col ctv:gap-1.5 ctv:size-full ctv:p-2 ctv:box-border ctv:text-xs ctv:text-base-foreground',
      !hasLinkedModel && fileDrop.dragActive.value
        && 'ctv:rounded ctv:outline ctv:outline-2 ctv:-outline-offset-2 ctv:outline-primary-background/70 ctv:bg-primary-background/5',
    ]"
    @dragenter="!hasLinkedModel && fileDrop.onDragEnter($event)"
    @dragover="!hasLinkedModel && fileDrop.onDragOver($event)"
    @dragleave="!hasLinkedModel && fileDrop.onDragLeave($event)"
    @drop="!hasLinkedModel && fileDrop.onDrop($event)"
    @contextmenu.stop.prevent
  >
    <div
      v-if="hasLinkedModel"
      class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:h-8 ctv:px-1.5
             ctv:rounded ctv:border ctv:border-border-default ctv:bg-secondary-background
             ctv:text-xs ctv:text-base-foreground"
    >
      <span class="ctv:relative ctv:size-6 ctv:shrink-0 ctv:overflow-hidden ctv:rounded-sm ctv:bg-secondary-background-hover">
        <ModelThumb v-if="linkedModel" :src="linkedModel" :alt="baseName(linkedModel)">
          <IconBox class="ctv:size-3.5" />
        </ModelThumb>
      </span>
      <span class="ctv:flex-1 ctv:min-w-0 ctv:truncate ctv:text-left">
        {{ $t('modelLoader.linkedHint') }}
        <span class="ctv:text-muted-foreground">· {{ baseName(linkedModel || '') }}</span>
      </span>
      <i class="pi pi-link ctv:shrink-0 ctv:text-3xs ctv:text-muted-foreground" />
    </div>
    <button
      v-else
      ref="triggerEl"
      type="button"
      class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:h-8 ctv:px-1.5 ctv:cursor-pointer
             ctv:rounded ctv:border ctv:border-border-default ctv:bg-secondary-background
             ctv:text-xs ctv:text-base-foreground ctv:[font-family:inherit] ctv:transition-colors
             ctv:hover:border-border-default ctv:hover:bg-secondary-background-hover"
      @click="toggleMenu"
    >
      <span class="ctv:relative ctv:size-6 ctv:shrink-0 ctv:overflow-hidden ctv:rounded-sm ctv:bg-secondary-background-hover">
        <ModelThumb v-if="selected" :src="selected" :alt="baseName(selected)">
          <IconBox class="ctv:size-3.5" />
        </ModelThumb>
        <span v-else class="ctv:flex ctv:size-full ctv:items-center ctv:justify-center ctv:text-muted-foreground">
          <IconBox class="ctv:size-3.5" />
        </span>
      </span>
      <span class="ctv:flex-1 ctv:min-w-0 ctv:truncate ctv:text-left"
            :class="selected ? '' : 'ctv:text-muted-foreground'">
        {{ selectedLabel }}
      </span>
      <i :class="['pi', menuOpen ? 'pi-chevron-up' : 'pi-chevron-down', 'ctv:shrink-0 ctv:text-3xs ctv:text-muted-foreground']" />
    </button>

    <div class="ctv-hover-host ctv:relative ctv:w-full ctv:flex-1 ctv:min-h-[280px] ctv:rounded-md ctv:overflow-hidden ctv:bg-black">
      <ModelPreview
        v-if="modelSrc"
        ref="previewEl"
        :src="modelSrc"
        pickable
        controls
        :part-materials="partMaterials"
        :selected-part="selectedPart"
        @parts-changed="onPartsChanged"
        @part-pick="onPartPick"
        @view-changed="scheduleCapture"
      />
      <div v-else
           class="ctv:h-full ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:text-white/50">
        <IconBox class="ctv:size-8 ctv:opacity-60" />
        <div class="ctv:text-xs">{{ $t('modelBinder.noModel') }}</div>
      </div>
      <div
        v-if="modelSrc && !isPrimSrc"
        :class="previewActionsClass"
        :data-busy="exporting ? '1' : undefined"
      >
        <button type="button" :class="previewActionBtn"
                :disabled="exporting"
                :title="exporting ? $t('stage.action.exportObjZipBusy') : $t('stage.action.exportObjZip')"
                @click.stop="onDownloadModel">
          <i :class="exporting ? 'pi pi-spin pi-spinner' : 'pi pi-download'" />
        </button>
        <button type="button" :class="previewTagBtn"
                :disabled="exporting"
                :title="$t('stage.action.addTag')"
                @click.stop="openTagMenu(modelSrc, nameFromUrl(modelSrc), $event, 'model')"><i class="pi pi-tag" /></button>
      </div>
    </div>

    <div
      v-if="modelSrc && materialSlots.length"
      class="ctv:flex ctv:flex-col ctv:gap-1"
      @pointerdown.stop
      @mousedown.stop
    >
      <div class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1 ctv:text-2xs">
        <span class="ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
          {{ selectedPart ? $t('modelBinder.selected', { part: selectedPart }) : $t('modelBinder.pickHint') }}
        </span>
        <template v-if="selectedPart">
          <button
            v-for="s in materialSlots"
            :key="s.slot"
            type="button"
            :class="chipClass(bindings[selectedPart] === s.slot)"
            :title="s.slot"
            @click="bindSelected(s.slot)"
          >
            <span class="ctv:size-3 ctv:rounded-full" :style="{ background: s.color }" />
            {{ s.label }}
          </button>
          <button
            v-if="bindings[selectedPart]"
            type="button"
            :class="chipClass(false)"
            @click="unbind(selectedPart)"
          ><i class="pi pi-times" /> {{ $t('modelBinder.unbind') }}</button>
        </template>
      </div>
      <div v-if="boundEntries.length" class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1">
        <button
          v-for="[part, slot] in boundEntries"
          :key="part"
          type="button"
          :class="chipClass(part === selectedPart)"
          :title="`${part} ← ${slot}`"
          @click="togglePart(part)"
        >
          <span class="ctv:size-2 ctv:rounded-full" :style="{ background: slotColor(slot) }" />
          <span class="ctv:max-w-24 ctv:truncate">{{ part }}</span>
          <span class="ctv:text-muted-foreground ctv:hover:text-destructive-background"
                @click.stop="unbind(part)"><i class="pi pi-times" /></span>
        </button>
      </div>
    </div>

    <div class="ctv:shrink-0">
      <StageCard
        :state="state"
        :node="node"
        :on-run-request="onRunRequest"
        :on-cancel-request="onCancelRequest"
        :on-disconnect="onDisconnect"
        :on-action="onAction"
        hide-context
        hide-output
      />
    </div>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="ctv:fixed ctv:inset-0 ctv:z-[9999]"
        @click="menuOpen = false"
        @wheel.stop
      >
        <div
          class="ctv:absolute ctv:flex ctv:flex-col ctv:gap-1.5 ctv:w-[380px] ctv:max-w-[92vw] ctv:p-2 ctv:rounded ctv:shadow-md
                 ctv:bg-interface-menu-surface ctv:text-xs ctv:text-base-foreground
                 ctv:border ctv:border-border-default"
          :style="menuStyle"
          @click.stop
        >
          <div class="ctv:flex ctv:items-center ctv:gap-1.5">
            <input
              ref="searchEl"
              v-model="query"
              type="text"
              :placeholder="$t('promptAssets.search')"
              class="ctv:flex-1 ctv:min-w-0 ctv:py-1 ctv:px-1.5 ctv:rounded-sm ctv:outline-none ctv:box-border
                     ctv:text-xs ctv:leading-snug ctv:[font-family:inherit]
                     ctv:bg-secondary-background ctv:text-base-foreground
                     ctv:border ctv:border-border-default ctv:focus:border-primary-background"
            />
            <button :class="uploadBtnClass" :disabled="uploading" @click="filePicker?.click()">
              <i class="pi pi-upload" />
              {{ uploading ? $t('modelLoader.uploading') : $t('modelLoader.upload') }}
            </button>
          </div>

          <div class="comfytv-asset-scroll ctv:h-[300px] ctv:shrink-0 ctv:overflow-y-scroll ctv:flex ctv:flex-col ctv:gap-2">
            <div v-if="filteredBuiltins.length" class="ctv:flex ctv:flex-col ctv:gap-1">
              <div class="ctv:px-0.5 ctv:text-3xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
                {{ $t('modelLoader.builtins') }}
              </div>
              <div class="ctv:grid ctv:grid-cols-3 ctv:gap-1.5">
                <button
                  v-for="b in filteredBuiltins"
                  :key="b.kind"
                  type="button"
                  :class="[
                    'ctv:relative ctv:flex ctv:flex-col ctv:items-center ctv:gap-1 ctv:p-1.5 ctv:cursor-pointer ctv:rounded',
                    'ctv:bg-secondary-background ctv:border ctv:[font-family:inherit] ctv:transition-colors',
                    selectedKind === b.kind
                      ? 'ctv:border-primary-background'
                      : 'ctv:border-border-subtle ctv:hover:border-primary-background/60',
                  ]"
                  :title="$t(`meshPrimitive.kind.${b.kind}`)"
                  @click="onPickBuiltin(b.kind)"
                >
                  <span
                    class="ctv:flex ctv:size-10 ctv:items-center ctv:justify-center ctv:rounded-sm
                           ctv:bg-secondary-background-hover ctv:text-muted-foreground"
                    aria-hidden="true"
                  >
                    <span :class="primIconClass(b.kind)" />
                  </span>
                  <span
                    v-if="selectedKind === b.kind"
                    class="ctv:absolute ctv:top-0.5 ctv:right-0.5 ctv:flex ctv:items-center ctv:justify-center
                           ctv:size-4 ctv:rounded-full ctv:text-3xs ctv:leading-none
                           ctv:bg-primary-background ctv:text-white"
                  ><i class="pi pi-check" /></span>
                  <span class="ctv:w-full ctv:truncate ctv:text-center ctv:text-3xs ctv:text-muted-foreground">
                    {{ $t(`meshPrimitive.kind.${b.kind}`) }}
                  </span>
                </button>
              </div>
            </div>

            <div class="ctv:flex ctv:flex-col ctv:gap-1">
              <div class="ctv:px-0.5 ctv:text-3xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground">
                {{ $t('modelLoader.uploaded') }}
              </div>
              <div v-if="filteredFiles.length === 0"
                   class="ctv:py-3 ctv:px-1.5 ctv:text-center ctv:italic ctv:text-muted-foreground/60">
                {{ $t('modelLoader.empty') }}
              </div>
              <div v-else class="ctv:grid ctv:grid-cols-4 ctv:gap-1.5">
                <button
                  v-for="file in filteredFiles"
                  :key="file"
                  type="button"
                  :class="[
                    'ctv:relative ctv:flex ctv:flex-col ctv:p-0 ctv:cursor-pointer ctv:overflow-hidden ctv:rounded',
                    'ctv:bg-secondary-background ctv:border ctv:[font-family:inherit] ctv:transition-colors',
                    file === selected
                      ? 'ctv:border-primary-background'
                      : 'ctv:border-border-subtle ctv:hover:border-primary-background/60',
                  ]"
                  :title="file"
                  @click="onPick(file)"
                >
                  <div class="ctv:relative ctv:w-full ctv:aspect-square ctv:bg-secondary-background-hover">
                    <ModelThumb :src="file" :alt="baseName(file)">
                      <IconBox class="ctv:size-7" />
                    </ModelThumb>
                  </div>
                  <span
                    v-if="file === selected"
                    class="ctv:absolute ctv:top-0.5 ctv:right-0.5 ctv:flex ctv:items-center ctv:justify-center
                           ctv:size-4 ctv:rounded-full ctv:text-3xs ctv:leading-none
                           ctv:bg-primary-background ctv:text-white"
                  ><i class="pi pi-check" /></span>
                  <span class="ctv:w-full ctv:truncate ctv:py-0.5 ctv:px-1 ctv:text-left ctv:text-3xs ctv:text-muted-foreground">
                    {{ baseName(file) }}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div v-if="uploadError" class="ctv:truncate ctv:text-2xs ctv:text-destructive-background">{{ uploadError }}</div>
        </div>
      </div>
    </Teleport>

    <input
      ref="filePicker"
      type="file"
      :accept="fileAccept"
      multiple
      class="ctv:hidden"
      @change="onPickFiles"
    />

    <Teleport to="body">
      <div
        v-if="tagMenu"
        class="ctv:fixed ctv:inset-0 ctv:z-[9999]"
        @click="closeTagMenu"
        @wheel.prevent.stop
      >
        <div
          class="ctv:absolute ctv:w-44 ctv:max-h-64 ctv:overflow-y-auto ctv:p-1 ctv:rounded ctv:shadow-md ctv:text-xs
                 ctv:bg-interface-menu-surface ctv:border ctv:border-border-default"
          :style="tagMenuStyle"
          @click.stop
        >
          <button
            type="button"
            class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:px-1.5 ctv:py-1 ctv:rounded-sm ctv:cursor-pointer
                   ctv:text-left ctv:text-2xs ctv:bg-transparent ctv:border-none ctv:text-base-foreground
                   ctv:hover:bg-secondary-background-hover"
            @click.stop="setUncategorized"
          >
            <span class="ctv:w-3 ctv:inline-block ctv:text-primary-background"><i v-if="tagMenuIsUncategorized()" class="pi pi-check" /></span>
            <span class="ctv:flex-1 ctv:truncate ctv:italic ctv:text-muted-foreground">{{ $t('assets.category.none') }}</span>
          </button>
          <div class="ctv:my-1 ctv:border-t ctv:border-border-subtle"></div>
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:px-1.5 ctv:py-1 ctv:rounded-sm ctv:cursor-pointer
                   ctv:text-left ctv:text-2xs ctv:bg-transparent ctv:border-none ctv:text-base-foreground
                   ctv:hover:bg-secondary-background-hover"
            @click.stop="toggleOutputTag(cat.id)"
          >
            <span class="ctv:w-3 ctv:inline-block ctv:text-primary-background"><i v-if="tagMenuHas(cat.id)" class="pi pi-check" /></span>
            <span class="ctv:flex-1 ctv:truncate">{{ cat.name }}</span>
          </button>
          <div v-if="categories.length" class="ctv:my-1 ctv:border-t ctv:border-border-subtle"></div>
          <button
            type="button"
            class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:px-1.5 ctv:py-1 ctv:rounded-sm ctv:cursor-pointer
                   ctv:text-left ctv:text-2xs ctv:bg-transparent ctv:border-none ctv:text-primary-background
                   ctv:hover:bg-secondary-background-hover"
            @click.stop="onCreateCategory"
          >
            <span class="ctv:w-3 ctv:inline-block"><i class="pi pi-plus" /></span>
            <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.tagPopover.create') }}</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import IconBox from '~icons/lucide/box'

import { app, type LGraphNode } from '@/lib/comfyApp'
import ModelPreview from '@/components/stages/ModelPreview.vue'
import ModelThumb from '@/components/widgets/ModelThumb.vue'
import StageCard from '@/components/stages/StageCard.vue'
import type { StageState } from '@/stores/stageStore'
import { askText } from '@/composables/dialog/useTextInputDialog'
import { useLoaderFileDrop } from '@/composables/stages/useLoaderFileDrop'
import {
  baseName,
  CAPTURE_SIZE,
  menuPanelStyle,
  useModelLoader,
} from '@/composables/stages/useModelLoader'
import { isPrimitivePayload } from '@/widgets/three/primitiveGeometry'
import { useOutputAssetTagging } from '@/composables/stages/useOutputAssetTagging'
import { downloadModelObjZip } from '@/utils/download'
import { MODEL_FILE_EXTENSIONS } from '@/widgets/three/modelFormats'

const { t } = useI18n()
const exporting = ref(false)

function toast(severity: 'info' | 'success' | 'warn' | 'error', summary: string, detail = '') {
  ;(app as any)?.extensionManager?.toast?.add?.({
    severity, summary, detail, life: severity === 'info' ? 12000 : 4000,
  })
}

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string, context?: { imageUrl?: string }) => void
  node: LGraphNode
}>()

const fileAccept = MODEL_FILE_EXTENSIONS.join(',')

const triggerEl = ref<HTMLButtonElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const filePicker = ref<HTMLInputElement | null>(null)
const previewEl = ref<InstanceType<typeof ModelPreview> | null>(null)
const menuOpen = ref(false)
const menuStyle = ref<Record<string, string>>({})

const loader = useModelLoader(props.node, {
  getState: () => props.state,
  onAction: (id, context) => props.onAction(id, context),
  captureCanvas: () => previewEl.value?.captureCanvas(CAPTURE_SIZE, CAPTURE_SIZE) ?? null,
  onSelected: () => { menuOpen.value = false },
})

const {
  selected,
  query,
  uploading,
  uploadError,
  filteredFiles,
  filteredBuiltins,
  linkedModel,
  hasLinkedModel,
  selectedKind,
  modelSrc,
  selectedPart,
  bindings,
  materialSlots,
  partMaterials,
  boundEntries,
  slotColor,
  onPartsChanged,
  onPartPick,
  bindSelected,
  togglePart,
  unbind,
  onPick,
  onPickBuiltin,
  uploadModelFiles,
  onPickFiles,
  scheduleCapture,
} = loader

const selectedLabel = computed(() => {
  if (selectedKind.value) return t(`meshPrimitive.kind.${selectedKind.value}`)
  if (selected.value) return baseName(selected.value)
  return t('modelLoader.pickHint')
})

const isPrimSrc = computed(() => isPrimitivePayload(modelSrc.value))

function primIconClass(kind: string): string {
  const base = 'ctv:block ctv:border ctv:border-current/70'
  switch (kind) {
    case 'plane':
      return `${base} ctv:size-6 ctv:rounded-sm ctv:bg-current/15`
    case 'cube':
      return `${base} ctv:size-5 ctv:rounded-[2px] ctv:bg-current/20 ctv:shadow-[2px_2px_0_0_currentColor]`
    case 'sphere':
      return `${base} ctv:size-6 ctv:rounded-full ctv:bg-current/20`
    case 'cylinder':
      return `${base} ctv:h-6 ctv:w-4 ctv:rounded-full ctv:bg-current/20`
    case 'cone':
      return 'ctv:block ctv:size-0 ctv:border-l-[10px] ctv:border-r-[10px] ctv:border-b-[18px] ctv:border-l-transparent ctv:border-r-transparent ctv:border-b-current/70'
    case 'torus':
      return `${base} ctv:size-6 ctv:rounded-full ctv:bg-transparent ctv:border-[5px]`
    default:
      return `${base} ctv:size-5 ctv:rounded-sm ctv:bg-current/20`
  }
}

const {
  tagMenu,
  categories,
  tagMenuStyle,
  nameFromUrl,
  isSaved,
  openTagMenu,
  closeTagMenu,
  tagMenuHas,
  tagMenuIsUncategorized,
  setUncategorized,
  toggleOutputTag,
  createCategoryAndTag,
} = useOutputAssetTagging()

const PREVIEW_BTN_BASE =
  'ctv:relative ctv:inline-flex ctv:items-center ctv:justify-center ctv:cursor-pointer ctv:appearance-none'
  + ' ctv:border-none ctv:transition-colors ctv:size-5 ctv:p-0 ctv:rounded-sm ctv:text-sm'
  + ' ctv:disabled:opacity-60 ctv:disabled:cursor-wait'
const previewActionsClass =
  'ctv-hover-reveal ctv:absolute ctv:top-1 ctv:right-1 ctv:z-10 ctv:flex ctv:gap-1'
const previewActionBtn = PREVIEW_BTN_BASE + ' ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90'
const previewTagBtn = computed(() => PREVIEW_BTN_BASE
  + (isSaved(modelSrc.value)
    ? ' ctv:bg-primary-background ctv:text-white ctv:hover:bg-primary-background/90'
    : ' ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90'))

async function onDownloadModel(): Promise<void> {
  if (!modelSrc.value || exporting.value) return
  exporting.value = true
  toast('info', t('stage.action.exportObjZipBusy'))
  try {
    await downloadModelObjZip(modelSrc.value)
    toast('success', t('stage.action.exportObjZipDone'))
  } catch (e: any) {
    console.error('[ComfyTV/model-loader] OBJ zip export failed', e)
    toast('error', t('stage.action.exportObjZipFailed'), String(e?.message || e))
  } finally {
    exporting.value = false
  }
}

async function onCreateCategory(): Promise<void> {
  const name = (await askText({
    title: t('assets.category.new'),
    label: t('assets.category.newPrompt'),
  }))?.trim()
  if (!name) return
  await createCategoryAndTag(name)
}

function chipClass(selected: boolean): string {
  return 'ctv:inline-flex ctv:items-center ctv:gap-1 ctv:cursor-pointer ctv:[font-family:inherit]'
    + ' ctv:rounded-lg ctv:border ctv:px-1.5 ctv:py-0.5 ctv:text-2xs ctv:transition-colors'
    + (selected
      ? ' ctv:border-primary-background ctv:bg-primary-background/20 ctv:text-base-foreground'
      : ' ctv:border-border-subtle ctv:bg-secondary-background ctv:text-muted-foreground'
        + ' ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground')
}

function toggleMenu(): void {
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  const rect = triggerEl.value?.getBoundingClientRect()
  if (!rect) return
  menuStyle.value = menuPanelStyle(rect, window.innerWidth, window.innerHeight)
  query.value = ''
  menuOpen.value = true
  void nextTick(() => searchEl.value?.focus())
}

const fileDrop = useLoaderFileDrop({
  kind: () => 'model',
  onFiles: uploadModelFiles,
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (tagMenu.value) closeTagMenu()
  else if (menuOpen.value) menuOpen.value = false
}

onMounted(() => {
  loader.init()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  loader.teardown()
})

const uploadBtnClass =
  'ctv:relative ctv:inline-flex ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:cursor-pointer'
  + ' ctv:whitespace-nowrap ctv:appearance-none ctv:border-none ctv:transition-colors'
  + ' ctv:disabled:pointer-events-none ctv:disabled:opacity-50'
  + ' ctv:h-6 ctv:rounded-sm ctv:px-2 ctv:py-1 ctv:text-xs ctv:font-medium ctv:shrink-0'
  + ' ctv:bg-secondary-background ctv:text-secondary-foreground ctv:hover:bg-secondary-background-hover'
</script>
