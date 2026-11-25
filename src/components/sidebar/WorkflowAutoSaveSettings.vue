<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  autoSaveSecondsLeft, configureWorkflowAutoSave, loadWorkflowAutoSave,
  saveWorkflowsNow, workflowAutoSave as state,
} from '@/composables/workflowAutoSave'
import SettingsSection from './SettingsSection.vue'

const props = defineProps<{ query?: string }>()
const { t } = useI18n({ useScope: 'local', messages: {
  zh: {
    title: '自动保存所有工作流', enable: '启用自动保存', interval: '保存间隔（秒）',
    desc: '与 Ctrl+S 一样，保存所有已打开的工作流到当前账号的 workflows，不提交到 Git。未命名工作流首次保存到“自动保存”文件夹。',
    apply: '应用', now: '立即保存全部', countdown: '下次保存：{time}', disabled: '自动保存已关闭',
    saving: '正在保存工作流…', waiting: '等待工作流操作完成后保存…',
    result: '上次保存：{time}，已保存 {count} 个工作流', failures: '{count} 个工作流保存失败',
    invalid: '保存间隔需为 10～86400 秒的整数', applied: '设置已生效', retry: '重新读取设置',
  },
  en: {
    title: 'Auto-save all workflows', enable: 'Enable auto-save', interval: 'Save interval (seconds)',
    desc: 'Save all open workflows to your account’s workflows folder, like Ctrl+S, without submitting to Git. Untitled workflows are first saved in the 自动保存 folder.',
    apply: 'Apply', now: 'Save all now', countdown: 'Next save: {time}', disabled: 'Auto-save is off',
    saving: 'Saving workflows…', waiting: 'Waiting for the current workflow operation…',
    result: 'Last saved: {time}, {count} workflows saved', failures: 'Could not save {count} workflows',
    invalid: 'Enter a whole number from 10 to 86400 seconds', applied: 'Settings applied', retry: 'Reload settings',
  },
} })
const enabled = ref(state.enabled)
const seconds = ref(state.intervalSeconds)
const error = ref('')
const applied = ref(false)
const collapsed = ref(false)
watch(() => [state.enabled, state.intervalSeconds], () => {
  enabled.value = state.enabled
  seconds.value = state.intervalSeconds
})
const visible = computed(() => !props.query?.trim() ||
  `${t('title')} ${t('desc')} autosave ctrl+s`.toLowerCase().includes(props.query.trim().toLowerCase()))
defineExpose({ visible })
const countdown = computed(() => {
  const seconds = autoSaveSecondsLeft.value ?? 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
async function apply() {
  error.value = ''
  applied.value = false
  if (!Number.isInteger(Number(seconds.value)) || Number(seconds.value) < 10 || Number(seconds.value) > 86400) {
    error.value = t('invalid')
    return
  }
  try {
    await configureWorkflowAutoSave(enabled.value, Number(seconds.value))
    applied.value = true
  } catch (e) {
    error.value = String(e instanceof Error ? e.message : e)
  }
}
</script>

<template>
  <SettingsSection
    v-if="visible"
    :section="{ id: 'workflowAutoSave', master: null, rows: [], experimental: false, dirty: false, probe: null }"
    :title="t('title')" :collapsed="collapsed" :master-on="false" @toggle="collapsed = !collapsed"
  >
    <div class="workflow-autosave-settings">
      <p>{{ t('desc') }}</p>
      <form @submit.prevent="apply" @keydown.stop>
        <label><input v-model="enabled" type="checkbox" :disabled="state.configuring"> {{ t('enable') }}</label>
        <label class="workflow-autosave-settings__interval">
          <span>{{ t('interval') }}</span>
          <input v-model.number="seconds" type="number" min="10" max="86400" step="1" :disabled="state.configuring" required>
        </label>
        <div class="workflow-autosave-settings__buttons">
          <button type="submit" :disabled="state.configuring">{{ t('apply') }}</button>
          <button type="button" :disabled="state.saving || state.configuring" @click="saveWorkflowsNow()">{{ t('now') }}</button>
        </div>
      </form>
      <div role="status">
        {{ state.saving ? t('saving') : state.waiting ? t('waiting') : state.enabled ? t('countdown', { time: countdown }) : t('disabled') }}
      </div>
      <div v-if="state.lastSavedAt && state.result">
        {{ t('result', { time: new Date(state.lastSavedAt).toLocaleTimeString(), count: state.lastSavedCount }) }}
      </div>
      <span v-if="applied" class="workflow-autosave-settings__ok">{{ t('applied') }}</span>
      <div v-if="error || state.error" role="alert">
        {{ error || state.error }}
        <button v-if="!state.loaded" type="button" @click="loadWorkflowAutoSave">{{ t('retry') }}</button>
      </div>
      <div v-if="state.result?.failures.length" role="alert">
        {{ t('failures', { count: state.result.failures.length }) }}
        <div v-for="failure in state.result.failures" :key="failure.path">{{ failure.path }}: {{ failure.error }}</div>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped>
.workflow-autosave-settings { padding: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.workflow-autosave-settings p { margin: 0; opacity: .65; line-height: 1.6; }
.workflow-autosave-settings form { display: flex; flex-direction: column; gap: 10px; }
.workflow-autosave-settings label { display: flex; align-items: center; gap: 7px; }
.workflow-autosave-settings input[type="checkbox"] { accent-color: #9ecbff; }
.workflow-autosave-settings__interval { justify-content: space-between; }
.workflow-autosave-settings input[type="number"] { width: 100px; box-sizing: border-box; padding: 5px 8px; border: 1px solid #555; border-radius: 6px; background: transparent; color: inherit; font: inherit; }
.workflow-autosave-settings__buttons { display: flex; gap: 8px; }
.workflow-autosave-settings button { padding: 5px 10px; border-radius: 7px; border: 1px solid #555; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.workflow-autosave-settings button:disabled { opacity: .45; cursor: default; }
.workflow-autosave-settings button:hover:enabled { background: rgba(255,255,255,.08); }
.workflow-autosave-settings__ok { color: #7dcea0; }
.workflow-autosave-settings [role="alert"] { color: #e6c07b; overflow-wrap: anywhere; }
</style>
