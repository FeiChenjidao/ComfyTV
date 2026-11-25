<template>
  <ComfyTVPopover v-model:open="menuOpen" align="end">
    <template #trigger>
      <button type="button" :class="buttonClass" :disabled="busy"
              :title="busy ? t('stage.action.exportModelBusy', { format: activeFormat.toUpperCase() }) : t('stage.action.exportModel')"
              @pointerdown.stop @mousedown.stop @click.stop>
        <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-download'" />
      </button>
    </template>
    <div class="ctv:min-w-20 ctv:p-1 ctv:border ctv:border-border-subtle ctv:rounded-md ctv:bg-secondary-background"
         @pointerdown.stop @mousedown.stop>
      <button v-for="format in MODEL_EXPORT_FORMATS" :key="format" type="button"
              class="ctv:block ctv:w-full ctv:border-0 ctv:bg-transparent ctv:px-3 ctv:py-1.5 ctv:text-left ctv:text-2xs ctv:text-base-foreground ctv:cursor-pointer ctv:hover:bg-secondary-background-hover"
              @click.stop="download(format)">{{ format.toUpperCase() }}</button>
    </div>
  </ComfyTVPopover>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ComfyTVPopover from '@/components/widgets/ComfyTVPopover.vue'
import { app } from '@/lib/comfyApp'
import { MODEL_EXPORT_FORMATS, type ModelExportFormat } from '@/widgets/three/modelExporter'

const props = defineProps<{
  exportModel: (format: ModelExportFormat) => Promise<void>
}>()
const emit = defineEmits<{ 'update:busy': [boolean] }>()
const { t } = useI18n()
const menuOpen = ref(false)
const busy = ref(false)
const activeFormat = ref<ModelExportFormat>('glb')
watch(menuOpen, (open) => emit('update:busy', open || busy.value))

const buttonClass = 'ctv:relative ctv:inline-flex ctv:items-center ctv:justify-center ctv:cursor-pointer ctv:appearance-none'
  + ' ctv:border-none ctv:transition-colors ctv:size-5 ctv:p-0 ctv:rounded-sm ctv:text-sm'
  + ' ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90 ctv:disabled:opacity-60 ctv:disabled:cursor-wait'

function toast(severity: 'info' | 'success' | 'error', detail = '') {
  const key = severity === 'info' ? 'exportModelBusy' : severity === 'success' ? 'exportModelDone' : 'exportModelFailed'
  ;(app as any)?.extensionManager?.toast?.add?.({
    severity, summary: t(`stage.action.${key}`, { format: activeFormat.value.toUpperCase() }),
    detail, life: severity === 'info' ? 12000 : 4000,
  })
}

async function download(format: ModelExportFormat) {
  if (busy.value) return
  busy.value = true
  activeFormat.value = format
  menuOpen.value = false
  emit('update:busy', true)
  toast('info')
  try {
    await props.exportModel(format)
    toast('success')
  } catch (e) {
    console.error('[ComfyTV/model] export failed', e)
    toast('error', e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
    emit('update:busy', false)
  }
}
</script>
