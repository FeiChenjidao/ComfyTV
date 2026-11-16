<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-2 ctv:px-2 ctv:py-2">
    <div class="ctv:text-2xs ctv:leading-relaxed ctv:text-muted-foreground">
      {{ $t('settings.pluginUpdate.desc') }}
    </div>

    <div class="ctv:rounded ctv:bg-amber-400/10 ctv:px-2 ctv:py-1.5 ctv:text-2xs ctv:leading-relaxed ctv:text-amber-400">
      {{ $t('settings.pluginUpdate.policy') }}
    </div>

    <div class="ctv:grid ctv:grid-cols-[auto_minmax(0,1fr)] ctv:gap-x-3 ctv:gap-y-1 ctv:text-2xs">
      <span class="ctv:text-muted-foreground">{{ $t('settings.pluginUpdate.current') }}</span>
      <span class="ctv:truncate ctv:text-base-foreground">{{ localLabel }}</span>
      <template v-if="status?.remote_version || status?.remote_sha">
        <span class="ctv:text-muted-foreground">{{ $t('settings.pluginUpdate.remote') }}</span>
        <span class="ctv:truncate ctv:text-base-foreground">{{ remoteLabel }}</span>
      </template>
    </div>

    <div
      v-if="statusMessage"
      class="ctv:rounded ctv:px-2 ctv:py-1.5 ctv:text-2xs ctv:leading-relaxed"
      :class="statusClass"
    >
      {{ statusMessage }}
      <div v-if="status?.dirty" class="ctv:mt-1 ctv:text-amber-400">
        {{ $t('settings.pluginUpdate.dirty') }}
      </div>
    </div>

    <div
      v-if="status?.rollback_available || status?.backup_path || status?.local_backups?.length || status?.dependency_files_changed?.length"
      class="ctv:flex ctv:flex-col ctv:gap-1 ctv:rounded ctv:bg-secondary-background-hover ctv:px-2 ctv:py-1.5 ctv:text-2xs ctv:leading-relaxed"
    >
      <div v-if="status?.rollback_available" class="ctv:text-base-foreground">
        {{ $t('settings.pluginUpdate.rollbackAvailable', { version: status.rollback_version || status.rollback_sha || '?' }) }}
      </div>
      <div v-if="status?.backup_path" class="ctv:break-all ctv:text-muted-foreground">
        {{ $t('settings.pluginUpdate.backupSaved', { path: status.backup_path }) }}
      </div>
      <div v-if="status?.local_backups?.length" class="ctv:text-amber-400">
        {{ $t('settings.pluginUpdate.collisionBackups', { n: status.local_backups.length }) }}
      </div>
      <div v-if="status?.dependency_files_changed?.length" class="ctv:text-amber-400">
        {{ $t('settings.pluginUpdate.dependenciesChanged', { files: status.dependency_files_changed.join(', ') }) }}
      </div>
    </div>

    <div class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-1.5">
      <button type="button" :class="buttonClass" :disabled="checking || rollingBack" @click="checkNow">
        <IconRefreshCw :class="['ctv:size-3.5', (checking || rollingBack) && 'ctv:animate-spin']" />
        {{ $t(checking ? 'settings.pluginUpdate.checking' : checked ? 'settings.pluginUpdate.recheck' : 'settings.pluginUpdate.check') }}
      </button>
      <button
        v-if="canApply"
        type="button"
        :class="primaryButtonClass"
        :disabled="checking || rollingBack"
        @click="showAvailableUpdate"
      >
        {{ $t(status?.update_available ? 'pluginUpdate.updateNow' : 'settings.pluginUpdate.repair') }}
      </button>
      <button
        v-if="status?.rollback_available"
        type="button"
        :class="buttonClass"
        :disabled="checking || rollingBack"
        @click="rollbackNow"
      >
        {{ $t(rollingBack ? 'settings.pluginUpdate.rollingBack' : 'settings.pluginUpdate.rollback') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconRefreshCw from '~icons/lucide/refresh-cw'

import { fetchPluginUpdateStatus, rollbackPluginUpdate, type PluginUpdateStatus } from '@/api'
import { askConfirm } from '@/composables/dialog/useConfirmDialog'
import { presentPluginRestart, presentPluginUpdate } from '@/composables/pluginUpdateCheck'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const { t } = useI18n()

const status = ref<PluginUpdateStatus | null>(null)
const checking = ref(false)
const rollingBack = ref(false)
const checked = ref(false)

const localLabel = computed(() => versionLabel(status.value?.local_version, status.value?.local_sha))
const remoteLabel = computed(() => versionLabel(status.value?.remote_version, status.value?.remote_sha))
const canApply = computed(() => Boolean(status.value?.update_available || status.value?.repair_available))

const statusMessage = computed(() => {
  if (checking.value) return t('settings.pluginUpdate.checking')
  const value = status.value
  if (!value) return ''
  if (value.error_code === 'request_failed') return t('settings.pluginUpdate.error', { error: value.error })
  if (!value.has_git) return t('settings.pluginUpdate.noGit')
  if (!value.is_repo) return t('settings.pluginUpdate.notRepo')
  if (value.error) return t('settings.pluginUpdate.error', { error: value.error })
  if (!checked.value) return ''
  if (value.update_available) {
    return t('settings.pluginUpdate.available', { n: value.behind })
  }
  if (value.repair_available) return t('settings.pluginUpdate.repairAvailable')
  return t('settings.pluginUpdate.upToDate')
})

const statusClass = computed(() => {
  if (checking.value) return 'ctv:bg-secondary-background-hover ctv:text-muted-foreground'
  const value = status.value
  if (!value?.has_git || !value?.is_repo || value?.error) {
    return 'ctv:bg-destructive-background/15 ctv:text-destructive-background'
  }
  if (value.update_available || value.repair_available) return 'ctv:bg-amber-400/10 ctv:text-amber-400'
  return 'ctv:bg-emerald-500/10 ctv:text-emerald-400'
})

function versionLabel(version?: string, sha?: string): string {
  const parts: string[] = []
  if (version) parts.push(`v${version}`)
  if (sha) parts.push(sha.slice(0, 12))
  return parts.join(' · ') || '—'
}

async function refresh(fetchRemote: boolean): Promise<PluginUpdateStatus | null> {
  checking.value = true
  try {
    status.value = await fetchPluginUpdateStatus(fetchRemote)
    return status.value
  } catch (error: any) {
    status.value = {
      ok: false,
      is_repo: false,
      has_git: true,
      update_available: false,
      local_version: status.value?.local_version || '',
      error: String(error?.message || error),
      error_code: 'request_failed',
      remote_version: '',
      local_sha: status.value?.local_sha || '',
      remote_sha: '',
      behind: 0,
      ahead: 0,
      dirty: false,
      repair_available: false,
      branch: '',
      remote: '',
      remote_url: '',
      restart_required: false,
      update_in_progress: false,
      rollback_available: false,
      rollback_sha: '',
      rollback_version: '',
      backup_path: '',
      local_backups: [],
      dependency_files_changed: [],
      rolled_back: false,
    }
    return status.value
  } finally {
    checking.value = false
  }
}

async function checkNow(): Promise<void> {
  if (checking.value) return
  checked.value = true
  const value = await refresh(true)
  if (value?.ok && value.update_available) await showAvailableUpdate()
}

async function showAvailableUpdate(): Promise<void> {
  if (!canApply.value || !status.value) return
  const action = await presentPluginUpdate(status.value)
  if (action === 'updated') {
    checked.value = true
    await refresh(false)
  }
}

async function rollbackNow(): Promise<void> {
  if (!status.value?.rollback_available || rollingBack.value) return
  const confirmed = await askConfirm({
    title: t('settings.pluginUpdate.rollbackTitle'),
    message: t('settings.pluginUpdate.rollbackConfirm', {
      version: status.value.rollback_version || status.value.rollback_sha || '?',
    }),
    confirmText: t('settings.pluginUpdate.rollback'),
    danger: true,
  })
  if (!confirmed) return
  rollingBack.value = true
  try {
    const result = await rollbackPluginUpdate()
    status.value = result
    checked.value = true
    if (result.ok && result.rolled_back) presentPluginRestart()
  } catch (error: any) {
    status.value = {
      ...status.value,
      ok: false,
      error: String(error?.message || error),
      error_code: 'rollback_failed',
    }
  } finally {
    rollingBack.value = false
  }
}

watch(
  () => props.active,
  (active) => {
    if (active && !status.value && !checking.value) void refresh(false)
  },
  { immediate: true },
)

const buttonClass = 'ctv:inline-flex ctv:h-7 ctv:items-center ctv:gap-1.5 ctv:rounded-lg ctv:border ' +
  'ctv:border-border-subtle ctv:bg-transparent ctv:px-2 ctv:text-xs ctv:text-base-foreground ctv:cursor-pointer ' +
  'ctv:hover:bg-secondary-background-hover ctv:disabled:pointer-events-none ctv:disabled:opacity-50'
const primaryButtonClass = 'ctv:inline-flex ctv:h-7 ctv:items-center ctv:rounded-lg ctv:border-none ' +
  'ctv:bg-primary-background ctv:px-2 ctv:text-xs ctv:text-primary-foreground ctv:cursor-pointer ' +
  'ctv:hover:opacity-90 ctv:disabled:pointer-events-none ctv:disabled:opacity-50'
</script>
