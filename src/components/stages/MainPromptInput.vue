<template>
  <div v-if="widget && promptVisible" ref="rootEl" class="ctv:relative ctv:pt-1 ctv:px-2 ctv:pb-1">
    <div
      v-if="upstreamTexts.length"
      class="ctv:mb-1 ctv:px-2 ctv:py-1 ctv:box-border ctv:rounded
             ctv:bg-primary-background/10 ctv:border ctv:border-dashed ctv:border-primary-background/40
             ctv:text-2xs ctv:leading-snug"
      :title="upstreamTextPreview"
    >
      <div class="ctv:flex ctv:items-center ctv:gap-1 ctv:text-primary-background ctv:font-medium">
        <i class="pi pi-link ctv:text-2xs" />
        <span>{{ $t('promptUpstream.connected', { n: upstreamTexts.length }) }}</span>
      </div>
      <div class="ctv:text-muted-foreground ctv:whitespace-pre-wrap ctv:break-words ctv:line-clamp-2">{{ upstreamTextPreview }}</div>
    </div>
    <EditorContent :editor="editor" class="comfytv-prompt-editor" />
    <div class="ctv:flex ctv:gap-1 ctv:mt-1">
      <ComfyTVPopover v-model:open="helperOpen" width="320px">
        <template #trigger>
          <button
            type="button"
            :class="[iconBtnClass, helperOpen
              ? 'ctv:bg-primary-background/20 ctv:border-primary-background/50 ctv:text-primary-background'
              : 'ctv:bg-secondary-background ctv:border-border-default ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground']"
            :title="$t('promptHelper.open')"
          ><i class="pi pi-sparkles" /></button>
        </template>
        <PromptHelperPanel :groups="helper.groups" :is-active="helper.isActive" @apply="helper.apply" />
      </ComfyTVPopover>
      <ComfyTVPopover v-model:open="beautifyOpen" width="320px" @update:open="onBeautifyToggle">
        <template #anchor>
          <button
            type="button"
            :class="[iconBtnClass,
              'ctv:disabled:pointer-events-none ctv:disabled:opacity-50',
              beautifyOpen || beautifyBusy
              ? 'ctv:bg-primary-background/20 ctv:border-primary-background/50 ctv:text-primary-background'
              : 'ctv:bg-secondary-background ctv:border-border-default ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground']"
            :title="$t('promptBeautify.open')"
            :disabled="beautifyBusy || !promptText.trim()"
            @click="onBeautifyClick"
          ><i :class="beautifyBusy ? 'pi pi-spin pi-spinner' : 'pi pi-bolt'" /></button>
        </template>
        <div class="ctv:p-2 ctv:flex ctv:flex-col ctv:gap-1.5
                    ctv:bg-interface-menu-surface ctv:border ctv:border-border-default ctv:rounded">
          <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('promptBeautify.preview') }}</span>
          <div
            class="ctv:max-h-40 ctv:overflow-y-auto ctv:px-2 ctv:py-1.5 ctv:rounded-sm ctv:text-xs
                   ctv:leading-snug ctv:whitespace-pre-wrap ctv:break-words
                   ctv:bg-interface-panel-surface ctv:border ctv:border-border-subtle ctv:text-base-foreground"
          >{{ beautifyPreview }}</div>
          <span v-if="beautifyMeta" class="ctv:text-2xs ctv:text-muted-foreground">{{ beautifyMeta }}</span>
          <div class="ctv:flex ctv:justify-end ctv:gap-1.5">
            <button :class="ghostBtnClass" @click="beautifyOpen = false">{{ $t('promptBeautify.discard') }}</button>
            <button :class="saveBtnClass" :disabled="!beautifyPreview.trim()" @click="onBeautifyApply">
              {{ $t('promptBeautify.apply') }}
            </button>
          </div>
        </div>
      </ComfyTVPopover>
      <ComfyTVPopover v-model:open="cameraOpen" width="320px">
        <template #trigger>
          <button
            type="button"
            :class="[iconBtnClass, cameraOpen
              ? 'ctv:bg-primary-background/20 ctv:border-primary-background/50 ctv:text-primary-background'
              : 'ctv:bg-secondary-background ctv:border-border-default ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground']"
            :title="$t('cameraPrompt.open')"
          ><i class="pi pi-video" /></button>
        </template>
        <CameraPromptPanel @insert="onCameraInsert" />
      </ComfyTVPopover>
      <button
        type="button"
        :class="[iconBtnClass,
          'ctv:bg-secondary-background ctv:border-border-default ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground']"
        :title="$t('mention.parse')"
        @click="onParseMentions"
      ><i class="pi pi-at" /></button>
      <ComfyTVPopover v-model:open="saveOpen" width="260px" @update:open="onSaveToggle">
        <template #trigger>
          <button
            type="button"
            :class="[iconBtnClass, saveOpen
              ? 'ctv:bg-primary-background/20 ctv:border-primary-background/50 ctv:text-primary-background'
              : 'ctv:bg-secondary-background ctv:border-border-default ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground']"
            :title="$t('promptSave.open')"
          ><i class="pi pi-bookmark" /></button>
        </template>
        <div class="ctv:p-2 ctv:flex ctv:flex-col ctv:gap-1.5
                    ctv:bg-interface-menu-surface ctv:border ctv:border-border-default ctv:rounded">
          <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('promptSave.hint') }}</span>
          <input
            v-model="saveLabel"
            class="ctv:h-6 ctv:box-border ctv:px-2 ctv:rounded-sm ctv:text-xs ctv:[font-family:inherit]
                   ctv:bg-interface-panel-surface ctv:border ctv:border-border-subtle ctv:text-base-foreground
                   ctv:placeholder:text-muted-foreground ctv:focus-visible:outline-none ctv:focus:border-border-default"
            :placeholder="$t('promptSave.labelPlaceholder')"
            @keydown.stop
            @keydown.enter.prevent="onSavePrompt"
            @keydown.escape="saveOpen = false"
          />
          <span v-if="saveError" class="ctv:text-2xs ctv:text-destructive-background">{{ saveError }}</span>
          <div class="ctv:flex ctv:justify-end ctv:gap-1.5">
            <button :class="saveBtnClass" :disabled="!canSavePrompt" @click="onSavePrompt">
              {{ $t('promptSave.save') }}
            </button>
          </div>
        </div>
      </ComfyTVPopover>
      <ComfyTVPopover v-model:open="entriesOpen" width="300px">
        <template #trigger>
          <button
            type="button"
            :class="[iconBtnClass, entriesOpen
              ? 'ctv:bg-primary-background/20 ctv:border-primary-background/50 ctv:text-primary-background'
              : 'ctv:bg-secondary-background ctv:border-border-default ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground']"
            :title="$t('promptEntries.open')"
          ><i class="pi pi-book" /></button>
        </template>
        <EntriesQuickPanel @insert="onEntryInsert" />
      </ComfyTVPopover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { EditorContent } from '@tiptap/vue-3'
import 'tippy.js/dist/tippy.css'

import { ApiError, beautifyPrompt, fetchWorkflowConfig } from '@/api'
import type { Entry } from '@/api/schemas'
import type { CameraSelection } from '@/composables/stages/cameraControlCatalog'
import { CAMERA_BUILDER } from '@/composables/stages/promptModules/builders'
import { nonSlotMentionLabels, normalizeMentionText } from '@/composables/stages/imageSlotMentions'
import { getStageMeta, loadStageMeta } from '@/composables/stages/stageMeta'
import { inlineContentFromText, upstreamTextInputs, useMainPromptInput } from '@/composables/stages/useMainPromptInput'
import { usePromptModules } from '@/composables/stages/usePromptModules'
import { app } from '@/lib/comfyApp'
import { useEntryStore } from '@/stores/entryStore'
import { useProjectStore } from '@/stores/projectStore'
import { isValidLabel } from '@/utils/labelRegex'
import { bindWidgetCallback, getWidget, onNodeConfigure } from '@/utils/widget'
import { WORKFLOW_CONFIG_CHANGED } from '@/utils/workflowEvents'
import type { LGraphNode } from '@/lib/comfyApp'

import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'

import CameraPromptPanel from './CameraPromptPanel.vue'
import EntriesQuickPanel from './EntriesQuickPanel.vue'
import MentionList from './MentionList.vue'
import PromptHelperPanel from './PromptHelperPanel.vue'

const props = defineProps<{ node?: LGraphNode }>()

const { t, locale: i18nLocale } = useI18n()

const rootEl = ref<HTMLElement | null>(null)

const { widget, editor, promptText, applyPromptText, stageState } = useMainPromptInput(
  () => props.node,
  MentionList,
)

const promptVisible = ref(true)
let promptVisibilityRequest = 0

async function refreshPromptVisibility() {
  promptVisible.value = true
  const request = ++promptVisibilityRequest
  const node = props.node
  const workflow = String(getWidget(node, 'workflow')?.value ?? '').trim()
  const nodeId = String(node?.comfyClass ?? '').trim()
  if (!workflow || !nodeId) return

  try {
    await loadStageMeta()
    const kind = getStageMeta(nodeId)?.workflow_kind
    if (!kind) return
    const config = await fetchWorkflowConfig(kind, workflow)
    if (request === promptVisibilityRequest) {
      promptVisible.value = config.meta?.prompt_required !== false
    }
  } catch {
    if (request === promptVisibilityRequest) promptVisible.value = true
  }
}

void refreshPromptVisibility()
bindWidgetCallback(props.node, 'workflow', () => { void refreshPromptVisibility() })
onNodeConfigure(props.node, () => { void refreshPromptVisibility() })
window.addEventListener(WORKFLOW_CONFIG_CHANGED, refreshPromptVisibility)
onScopeDispose(() => window.removeEventListener(WORKFLOW_CONFIG_CHANGED, refreshPromptVisibility))

const upstreamTexts = computed(() => upstreamTextInputs(stageState.value?.inputs))
const upstreamTextPreview = computed(() =>
  upstreamTexts.value
    .map(i => String(i.content ?? '').trim() || t('promptUpstream.pending'))
    .join('\n'))

const helperOpen = ref(false)
const helper = usePromptModules(() => promptText.value, applyPromptText)

const beautifyOpen = ref(false)
const beautifyBusy = ref(false)
const beautifyPreview = ref('')
const beautifyMeta = ref('')
let beautifyRequest = 0

function toast(severity: 'success' | 'warn' | 'error', summary: string, detail = '') {
  ;(app as any)?.extensionManager?.toast?.add?.({ severity, summary, detail, life: 5000 })
}

function onBeautifyToggle(open: boolean) {
  if (!open) {
    beautifyPreview.value = ''
    beautifyMeta.value = ''
  }
}

function beautifyErrorDetail(e: unknown): string {
  if (e instanceof ApiError) {
    const raw = e.message.replace(/^[\s\S]*failed \[\d+\]:\s*/, '') || e.message
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.code === 'no_llm') return t('promptBeautify.noLlm')
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim()
      }
    } catch { /* plain text body */ }
    if (/no LLM available/i.test(raw)) return t('promptBeautify.noLlm')
    return raw
  }
  return String((e as any)?.message || e)
}

async function onBeautifyClick() {
  if (beautifyBusy.value || !promptText.value.trim()) return

  const request = ++beautifyRequest
  beautifyBusy.value = true
  beautifyOpen.value = false
  beautifyPreview.value = ''
  beautifyMeta.value = ''
  try {
    const locale = String(i18nLocale.value || 'en')
    const language = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    const res = await beautifyPrompt(promptText.value, language)
    if (request !== beautifyRequest) return
    beautifyPreview.value = res.prompt
    beautifyMeta.value = t('promptBeautify.via', { provider: res.provider, model: res.model })
    beautifyOpen.value = true
  } catch (e: unknown) {
    if (request !== beautifyRequest) return
    toast('error', t('promptBeautify.failed'), beautifyErrorDetail(e))
  } finally {
    if (request === beautifyRequest) beautifyBusy.value = false
  }
}

function onBeautifyApply() {
  const next = beautifyPreview.value.trim()
  if (!next) return
  applyPromptText(normalizeMentionText(next))
  beautifyOpen.value = false
  toast('success', t('promptBeautify.applied'))
}

const cameraOpen = ref(false)
function onCameraInsert(selection: CameraSelection) {
  helper.apply(CAMERA_BUILDER, selection as Record<string, string>)
}

const entriesOpen = ref(false)
function onEntryInsert(entry: Entry) {
  const ed = editor.value
  if (!ed) return
  const content = entry.kind === 'prompt'
    ? inlineContentFromText(normalizeMentionText(entry.content))
    : [
        { type: 'mention', attrs: { id: entry.label, label: entry.label } },
        { type: 'text', text: ' ' },
      ]
  ed.chain().focus().insertContent(content).run()
}

function onParseMentions() {
  applyPromptText(normalizeMentionText(promptText.value))
}

const entryStore = useEntryStore()
const projectStore = useProjectStore()

const saveOpen = ref(false)
const saveLabel = ref('')
const saveDone = ref(false)

const saveError = computed(() => {
  if (saveDone.value) return ''
  const bad = nonSlotMentionLabels(normalizeMentionText(promptText.value))
  if (bad.length) {
    return t('promptSave.entryRefsError', { tokens: bad.map(l => `@${l}`).join(' ') })
  }
  if (saveLabel.value && !isValidLabel(saveLabel.value)) return t('entries.labelError')
  return ''
})

const canSavePrompt = computed(() =>
  !!promptText.value.trim()
  && isValidLabel(saveLabel.value)
  && nonSlotMentionLabels(normalizeMentionText(promptText.value)).length === 0,
)

function onSaveToggle(open: boolean) {
  saveDone.value = false
  if (open) saveLabel.value = ''
}

async function onSavePrompt() {
  if (!canSavePrompt.value) return
  const row = await entryStore.upsert(projectStore.currentProjectId || '', {
    kind: 'prompt',
    label: saveLabel.value,
    content: normalizeMentionText(promptText.value).trim(),
  })
  if (row) {
    saveDone.value = true
    saveOpen.value = false
  }
}

const iconBtnClass = 'ctv:inline-flex ctv:items-center ctv:justify-center ctv:size-5 ctv:cursor-pointer'
  + ' ctv:rounded-sm ctv:border ctv:text-2xs ctv:leading-none ctv:[font-family:inherit] ctv:transition-colors'

const saveBtnClass = 'ctv:inline-flex ctv:items-center ctv:justify-center ctv:gap-1 ctv:cursor-pointer'
  + ' ctv:h-6 ctv:rounded-sm ctv:px-2 ctv:text-xs ctv:font-medium ctv:border-none ctv:transition-colors'
  + ' ctv:bg-primary-background ctv:text-base-foreground ctv:hover:bg-primary-background-hover'
  + ' ctv:disabled:pointer-events-none ctv:disabled:opacity-50'

const ghostBtnClass = 'ctv:inline-flex ctv:items-center ctv:justify-center ctv:gap-1 ctv:cursor-pointer'
  + ' ctv:h-6 ctv:rounded-sm ctv:px-2 ctv:text-xs ctv:font-medium ctv:border ctv:transition-colors'
  + ' ctv:bg-transparent ctv:border-border-default ctv:text-muted-foreground'
  + ' ctv:hover:bg-secondary-background ctv:hover:text-base-foreground'
</script>

<style>
.comfytv-prompt-prosemirror {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
}
.comfytv-prompt-prosemirror::-webkit-scrollbar {
  width: 10px;
}
.comfytv-prompt-prosemirror::-webkit-scrollbar-track {
  background: transparent;
}
.comfytv-prompt-prosemirror::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.35);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: content-box;
}
.comfytv-prompt-prosemirror:hover::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.55);
}

.tippy-box[data-theme~='comfytv-transparent'] {
  background: transparent;
  box-shadow: none;
}
.tippy-box[data-theme~='comfytv-transparent'] > .tippy-content { padding: 0; }

.tippy-box[data-theme~='comfytv-tooltip'] {
  background: var(--interface-menu-surface, #1a1a1a);
  border: 1px solid var(--border-default, #3a3a3a);
  color: var(--base-foreground, #e0e0e0);
  font-size: 11px;
  line-height: 1.45;
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.tippy-box[data-theme~='comfytv-tooltip'] > .tippy-content {
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.tippy-box[data-theme~='comfytv-tooltip'][data-placement^='top']    > .tippy-arrow::before { border-top-color: var(--border-default, #3a3a3a); }
.tippy-box[data-theme~='comfytv-tooltip'][data-placement^='bottom'] > .tippy-arrow::before { border-bottom-color: var(--border-default, #3a3a3a); }
.tippy-box[data-theme~='comfytv-tooltip'][data-placement^='left']   > .tippy-arrow::before { border-left-color: var(--border-default, #3a3a3a); }
.tippy-box[data-theme~='comfytv-tooltip'][data-placement^='right']  > .tippy-arrow::before { border-right-color: var(--border-default, #3a3a3a); }
</style>

<style scoped>
.comfytv-prompt-editor :deep(p) { margin: 0; }
.comfytv-prompt-editor :deep(p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--muted-foreground, #888);
  opacity: 0.65;
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
