<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-3">
    <p class="ctv:m-0 ctv:text-xs ctv:leading-relaxed ctv:text-base-foreground ctv:whitespace-pre-wrap">
      {{ message }}
    </p>
    <div
      v-if="status.remote_url"
      class="ctv:text-[11px] ctv:text-muted-foreground ctv:break-all"
    >{{ status.remote_url }}</div>
    <div v-if="error" class="ctv:text-xs ctv:text-red-400 ctv:whitespace-pre-wrap">{{ error }}</div>
    <div class="ctv:flex ctv:flex-wrap ctv:justify-end ctv:gap-2">
      <button type="button" :class="btnGhost" :disabled="busy" @click="resolve('dismiss')">
        {{ $t('pluginUpdate.dismiss') }}
      </button>
      <button type="button" :class="btnGhost" :disabled="busy" @click="resolve('later')">
        {{ $t('pluginUpdate.later') }}
      </button>
      <button
        type="button"
        :class="btnPrimary"
        :disabled="busy"
        @click="onUpdate"
      >
        {{ busy ? $t('pluginUpdate.updating') : $t('pluginUpdate.updateNow') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { applyPluginUpdate, type PluginUpdateStatus } from '@/api'

const props = defineProps<{
  status: PluginUpdateStatus
  onResolve: (action: 'later' | 'dismiss' | 'updated' | 'failed') => void
}>()

const { t } = useI18n()
const busy = ref(false)
const error = ref('')
let resolved = false

const message = computed(() => {
  const local = props.status.local_version || '?'
  const remote = props.status.remote_version || props.status.remote_sha || '?'
  const behind = props.status.behind || 0
  if (props.status.dirty) {
    return t('pluginUpdate.messageDirty', { local, remote, n: behind })
  }
  return t('pluginUpdate.message', { local, remote, n: behind })
})

function resolve(action: 'later' | 'dismiss' | 'updated' | 'failed') {
  if (resolved) return
  resolved = true
  props.onResolve(action)
}

async function onUpdate() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await applyPluginUpdate()
    if (!res.ok || res.error_code === 'pull_failed') {
      error.value = res.error || t('pluginUpdate.failed')
      busy.value = false
      return
    }
    resolve('updated')
  } catch (e: any) {
    error.value = String(e?.message || e) || t('pluginUpdate.failed')
    busy.value = false
  }
}

onBeforeUnmount(() => {
  if (!resolved) resolve('later')
})

const btnGhost = 'ctv:appearance-none ctv:border-none ctv:cursor-pointer ctv:[font-family:inherit] ' +
  'ctv:focus-visible:outline-none ctv:h-7 ctv:px-3 ctv:rounded-sm ctv:text-xs ' +
  'ctv:bg-secondary-background ctv:text-muted-foreground ' +
  'ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground ' +
  'ctv:disabled:opacity-50 ctv:disabled:cursor-not-allowed'
const btnPrimary = 'ctv:appearance-none ctv:border-none ctv:cursor-pointer ctv:[font-family:inherit] ' +
  'ctv:focus-visible:outline-none ctv:h-7 ctv:px-3 ctv:rounded-sm ctv:text-xs ctv:font-medium ' +
  'ctv:bg-primary-background ctv:text-primary-foreground ctv:hover:opacity-90 ' +
  'ctv:disabled:opacity-50 ctv:disabled:cursor-not-allowed'
</script>
