<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { NativeWorkflow } from '@/api'
import {
  groupWorkflowRows, initialWorkflowGroups, loadWorkflowGroups,
  newWorkflowGroupId, removeWorkflowGroup, saveWorkflowGroups,
  WorkflowGroupsSchema,
  type WorkflowGroups, type WorkflowScope,
} from './workflowGroups'

const props = defineProps<{
  templates: NativeWorkflow[]
  local: NativeWorkflow[]
  openingPath: string | null
  badges: Map<string, { key: string; label: string }[]>
  disabled?: boolean
}>()
const emit = defineEmits<{ open: [row: NativeWorkflow, fromTemplate: boolean] }>()
const { t } = useI18n({
  useScope: 'local',
  messages: {
    zh: {
      manage: '管理分组', done: '完成', templates: '模板', local: '工作流',
      newGroup: '新建分组', groupName: '分组名称', add: '添加', rename: '重命名',
      delete: '删除分组', deleteHint: '删除后，组内工作流移入未分组',
      ungrouped: '未分组', move: '移动到分组', empty: '此分组暂无工作流',
      loading: '正在读取分组…', saving: '正在保存…', saved: '分组已保存',
      loadFailed: '分组读取失败，请重试。', saveFailed: '分组保存失败，请重试。', retry: '重试',
      duplicate: '分组名称已存在', invalidName: '请输入不超过 60 个字的分组名称', openHint: '打开为新的工作流',
      templatesEmpty: '暂无云端模板', localEmpty: '暂无本地工作流。在 ComfyUI 保存到本账号 workflows 即可出现在这里。',
      character: '角色', scene: '场景', general: '通用', testing: '测试',
    },
    en: {
      manage: 'Manage groups', done: 'Done', templates: 'Templates', local: 'Workflows',
      newGroup: 'New group', groupName: 'Group name', add: 'Add', rename: 'Rename',
      delete: 'Delete group', deleteHint: 'Move workflows to Ungrouped when deleting',
      ungrouped: 'Ungrouped', move: 'Move to group', empty: 'No workflows in this group',
      loading: 'Loading groups…', saving: 'Saving…', saved: 'Groups saved',
      loadFailed: 'Could not load groups. Please retry.', saveFailed: 'Could not save groups. Please retry.', retry: 'Retry',
      duplicate: 'Group name already exists', invalidName: 'Enter a group name of up to 60 characters', openHint: 'Open as a new workflow',
      templatesEmpty: 'No cloud templates yet', localEmpty: 'No local workflows yet. Save to your account’s workflows folder in ComfyUI.',
      character: 'Character', scene: 'Scene', general: 'General', testing: 'Testing',
    },
  },
})

const scopes = ['templates', 'local'] as const
const state = ref<WorkflowGroups | null>(null)
const managing = ref(false)
const loading = ref(true)
const saving = ref(false)
const loadError = ref(false)
const saveError = ref(false)
const saved = ref(false)
const validationError = ref('')
const newNames = ref({ templates: '', local: '' })
const collapsed = ref(new Set<string>())
const columns = computed(() => scopes.map(scope => ({
  scope, rows: props[scope],
  groups: state.value ? groupWorkflowRows(props[scope], state.value[scope]) : [],
})))
const templateGroups = computed(() => state.value?.templates.groups ?? [])
const ready = computed(() => !!state.value && !loading.value && !saving.value && !loadError.value && !saveError.value)

async function assignTemplateGroup(paths: string[], groupId: string) {
  if (!ready.value) throw new Error(t('loadFailed'))
  // Re-read account preferences so assigning published workflows preserves any
  // other changes saved since this panel was opened.
  const current = await loadWorkflowGroups() ?? WorkflowGroupsSchema.parse(state.value!)
  if (groupId && !current.templates.groups.some(group => group.id === groupId)) {
    throw new Error(t('loadFailed'))
  }
  for (const path of paths) current.templates.assignments[path] = groupId
  await saveWorkflowGroups(current)
  state.value = current
}

async function createTemplateGroup(rawName: string): Promise<string> {
  if (!ready.value) throw new Error(t('loadFailed'))
  const name = rawName.trim()
  if (!name || name.length > 60) throw new Error(t('invalidName'))
  saving.value = true
  try {
    const current = await loadWorkflowGroups() ?? WorkflowGroupsSchema.parse(state.value!)
    if (current.templates.groups.some(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error(t('duplicate'))
    }
    const id = newWorkflowGroupId()
    current.templates.groups.push({ id, name })
    await saveWorkflowGroups(current)
    state.value = current
    return id
  } finally {
    saving.value = false
  }
}

defineExpose({ templateGroups, ready, assignTemplateGroup, createTemplateGroup })

async function load() {
  loading.value = true
  loadError.value = false
  try {
    state.value = await loadWorkflowGroups()
    if (!state.value) {
      state.value = initialWorkflowGroups(props, id => t(id))
      await persist()
    }
  } catch {
    state.value = initialWorkflowGroups(props, id => t(id))
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function persist() {
  if (!state.value || saving.value) return
  saving.value = true
  saveError.value = false
  saved.value = false
  try {
    await saveWorkflowGroups(state.value)
    saved.value = true
  } catch {
    saveError.value = true
  } finally {
    saving.value = false
  }
}
function nameAvailable(scope: WorkflowScope, name: string, except?: string) {
  validationError.value = ''
  const duplicate = state.value![scope].groups.some(group =>
    group.id !== except && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (duplicate) validationError.value = t('duplicate')
  return !duplicate
}
async function addGroup(scope: WorkflowScope) {
  const name = newNames.value[scope].trim().slice(0, 60)
  if (!name || !nameAvailable(scope, name)) return
  state.value![scope].groups.push({ id: newWorkflowGroupId(), name })
  newNames.value[scope] = ''
  await persist()
}
async function renameGroup(scope: WorkflowScope, id: string, event: Event) {
  const input = event.target as HTMLInputElement
  const group = state.value![scope].groups.find(group => group.id === id)!
  const name = input.value.trim()
  if (name && nameAvailable(scope, name, id)) {
    group.name = name
    await persist()
  }
  input.value = group.name
}
async function deleteGroup(scope: WorkflowScope, id: string) {
  removeWorkflowGroup(state.value![scope], id)
  await persist()
}
async function move(scope: WorkflowScope, path: string, event: Event) {
  const id = (event.target as HTMLSelectElement).value
  state.value![scope].assignments[path] = id
  await persist()
}
function toggle(scope: WorkflowScope, id: string) {
  const key = `${scope}:${id}`
  if (collapsed.value.has(key)) collapsed.value.delete(key)
  else collapsed.value.add(key)
}
</script>

<template>
  <div class="workflow-library">
    <div class="workflow-library__tools">
      <span v-if="saving" role="status">{{ t('saving') }}</span>
      <span v-else-if="saved && !saveError" role="status">{{ t('saved') }}</span>
      <button type="button" :disabled="disabled || loading || loadError || saving" :aria-pressed="managing" @click="managing = !managing">
        {{ managing ? t('done') : t('manage') }}
      </button>
    </div>
    <div v-if="loading" class="workflow-library__message">{{ t('loading') }}</div>
    <div v-else-if="loadError" class="workflow-library__message" role="alert">
      {{ t('loadFailed') }} <button type="button" @click="load">{{ t('retry') }}</button>
    </div>
    <template v-if="!loading && state">
      <div v-if="saveError" class="workflow-library__message" role="alert">
        {{ t('saveFailed') }} <button type="button" :disabled="disabled || saving" @click="persist">{{ t('retry') }}</button>
      </div>
      <div v-if="validationError" class="workflow-library__message" role="alert">{{ validationError }}</div>
      <div class="workflow-library__columns">
        <section v-for="column in columns" :key="column.scope" class="workflow-library__column" :aria-label="t(column.scope)">
          <h3>{{ t(column.scope) }}</h3>
          <form v-if="managing" class="workflow-library__new" @submit.prevent="addGroup(column.scope)" @keydown.stop>
            <input v-model="newNames[column.scope]" :aria-label="`${t(column.scope)}: ${t('groupName')}`" :placeholder="t('newGroup')" maxlength="60" :disabled="disabled || saving">
            <button type="submit" :disabled="disabled || saving || !newNames[column.scope].trim()">{{ t('add') }}</button>
          </form>
          <div class="workflow-library__scroll">
            <div v-if="!column.rows.length && !managing" class="workflow-library__message">{{ t(column.scope === 'templates' ? 'templatesEmpty' : 'localEmpty') }}</div>
            <template v-for="group in column.groups" :key="group.id">
              <div v-if="group.rows.length || managing" class="workflow-library__group">
                <div class="workflow-library__group-head">
                  <button type="button" class="workflow-library__toggle" :aria-expanded="!collapsed.has(`${column.scope}:${group.id}`)" @click="toggle(column.scope, group.id)">
                    <span aria-hidden="true">{{ collapsed.has(`${column.scope}:${group.id}`) ? '▸' : '▾' }}</span>
                    <span>{{ group.id ? group.name : t('ungrouped') }}</span>
                    <small>{{ group.rows.length }}</small>
                  </button>
                  <button v-if="managing && group.id" type="button" :disabled="disabled || saving" :title="t('deleteHint')" :aria-label="`${t('delete')}: ${group.name}`" @click="deleteGroup(column.scope, group.id)">×</button>
                </div>
                <template v-if="!collapsed.has(`${column.scope}:${group.id}`)">
                  <input v-if="managing && group.id" class="workflow-library__rename" :value="group.name" :aria-label="`${t('rename')}: ${group.name}`" maxlength="60" :disabled="disabled || saving" @keydown.stop @change="renameGroup(column.scope, group.id, $event)">
                  <div v-if="!group.rows.length && managing" class="workflow-library__message">{{ t('empty') }}</div>
                  <div v-for="row in group.rows" :key="row.path" class="workflow-library__entry">
                    <button type="button" class="workflow-library__row" :disabled="openingPath === row.path || (column.scope === 'templates' && row.mtime === 0)" :title="column.scope === 'templates' ? `${t('openHint')}\n${row.path}` : row.path" @click="emit('open', row, column.scope === 'templates')">
                      <span class="workflow-library__name">{{ row.name }}</span>
                      <span v-for="badge in badges.get(row.path) || []" :key="badge.key" class="workflow-library__badge" :class="`workflow-library__badge--${badge.key}`">{{ badge.label }}</span>
                    </button>
                    <select v-if="managing" :value="group.id" :aria-label="`${t('move')}: ${row.name}`" :disabled="disabled || saving" @keydown.stop @change="move(column.scope, row.path, $event)">
                      <option value="">{{ t('ungrouped') }}</option>
                      <option v-for="option in state[column.scope].groups" :key="option.id" :value="option.id">{{ option.name }}</option>
                    </select>
                  </div>
                </template>
              </div>
            </template>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.workflow-library { width: 100%; min-width: 0; }
.workflow-library__tools { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 2px 8px; font-size: 11px; }
.workflow-library__tools > span { color: #7dcea0; }
.workflow-library button { border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 4px 7px; }
.workflow-library button:hover:not(:disabled) { background: rgba(255,255,255,.09); }
.workflow-library button:disabled { opacity: .45; cursor: default; }
.workflow-library button:focus-visible, .workflow-library input:focus-visible, .workflow-library select:focus-visible { outline: 1px solid #9ecbff; outline-offset: -1px; }
.workflow-library__tools button { background: rgba(255,255,255,.07); }
.workflow-library__columns { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 8px; }
.workflow-library__column { min-width: 0; padding: 4px; border-radius: 12px; background: color-mix(in srgb, var(--color-base-foreground, #fff) 4%, transparent); }
.workflow-library h3 { margin: 4px 6px 8px; font-size: 11px; opacity: .6; }
.workflow-library__scroll { max-height: min(50vh, 420px); overflow: auto; scrollbar-width: thin; }
.workflow-library__group { margin-bottom: 5px; }
.workflow-library__group-head { display: flex; align-items: center; }
.workflow-library .workflow-library__toggle { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; text-align: left; font-size: 12px; font-weight: 600; }
.workflow-library__toggle > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-library__toggle small { margin-left: auto; opacity: .45; font-weight: 400; }
.workflow-library .workflow-library__row { display: flex; align-items: center; gap: 4px; width: 100%; padding: 9px 8px 9px 20px; text-align: left; font-size: 13px; }
.workflow-library__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-library__badge { flex: none; font-size: 10px; padding: 1px 4px; border-radius: 4px; }
.workflow-library__badge--new { background: #e6c07b; color: #1a1a1a; }
.workflow-library__badge--modified { background: #9ecbff; color: #0b1b2b; }
.workflow-library__badge--outdated { background: #7dcea0; color: #0b1f14; }
.workflow-library input, .workflow-library select { box-sizing: border-box; min-width: 0; max-width: 100%; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 5px 6px; background: var(--color-agent-surface, #242424); color: inherit; font: inherit; font-size: 11px; color-scheme: dark; }
.workflow-library__new { display: flex; gap: 3px; padding: 0 2px 8px; }
.workflow-library__new input { flex: 1; width: 0; }
.workflow-library__rename { width: calc(100% - 12px); margin: 3px 6px; }
.workflow-library__entry select { width: calc(100% - 26px); margin: 0 6px 6px 20px; }
.workflow-library__message { padding: 9px 7px; font-size: 11px; line-height: 1.5; opacity: .65; }
.workflow-library [role="alert"] { opacity: 1; color: #e6c07b; }
</style>
