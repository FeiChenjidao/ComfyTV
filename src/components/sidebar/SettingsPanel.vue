<template>
  <TooltipProvider>
  <div class="ctv:relative ctv:flex ctv:flex-col ctv:size-full ctv:box-border ctv:overflow-hidden ctv:text-xs ctv:text-base-foreground">
    <div class="ctv:shrink-0 ctv:flex ctv:items-center ctv:gap-2 ctv:py-1.5 ctv:px-2.5
                ctv:bg-interface-panel-surface ctv:border-b ctv:border-border-subtle">
      <span class="ctv:flex-1 ctv:font-semibold ctv:text-sm">{{ $t('settings.title') }}</span>
      <button
        :class="primaryBtnClass"
        :disabled="!dirty || saving"
        @click="save"
      >
        {{ saving ? $t('settings.saving') : $t('settings.save') }}
        <span v-if="dirtyCount && !saving">({{ dirtyCount }})</span>
      </button>
    </div>

    <div class="ctv:shrink-0 ctv:flex ctv:items-center ctv:gap-1.5 ctv:px-1.5 ctv:pt-1.5">
      <IconSearch class="ctv:shrink-0 ctv:size-3.5 ctv:text-muted-foreground" />
      <ComfyTVText
        class="ctv:flex-1"
        :model-value="query"
        :placeholder="$t('settings.search')"
        @update:model-value="(v: string) => query = v"
      />
    </div>

    <div class="ctv:flex-1 ctv:min-h-0 ctv:overflow-y-auto ctv:p-1.5 ctv:flex ctv:flex-col ctv:gap-1.5">
      <div v-if="error" class="ctv:py-1 ctv:px-1.5 ctv:rounded ctv:bg-destructive-background/15 ctv:text-destructive-background">
        {{ error }}
      </div>

      <div
        v-if="loading && rows.length === 0"
        class="ctv:py-5 ctv:px-1.5 ctv:text-center ctv:italic ctv:text-muted-foreground/60"
      >
        {{ $t('settings.loading') }}
      </div>

      <template v-else>
        <SettingsSection
          v-if="pluginUpdateVisible"
          :section="pluginUpdateSection"
          :title="$t('settings.pluginUpdate.section')"
          :collapsed="isCollapsed('pluginUpdate')"
          :master-on="false"
          @toggle="toggleCollapsed('pluginUpdate')"
        >
          <PluginUpdateSettings :active="props.active !== false" />
        </SettingsSection>

        <SettingsSection
          v-for="s in sections"
          :key="s.id"
          :section="s"
          :title="$t(`settings.${s.id}.section`)"
          :collapsed="isCollapsed(s.id)"
          :master-on="s.master !== null && values[s.master.key] === true"
          @toggle="toggleCollapsed(s.id)"
          @master="(v) => s.master && setValue(s.master.key, v)"
        >
          <SettingItem
            v-for="row in s.rows"
            :key="row.key"
            :row="row"
            :value="values[row.key]"
            :depth="depthOf(row.key)"
            :suggestions="modelSuggestions(row.key)"
            @update="(v) => setValue(row.key, v)"
          />
          <div v-if="s.id === 'backup'" class="ctv:flex ctv:flex-col ctv:gap-1 ctv:px-2 ctv:py-1.5">
            <div>
              <button :class="chipBtnClass" :disabled="backingUp" @click="backupNow">
                {{ backingUp ? $t('settings.backup.running') : $t('settings.backup.now') }}
              </button>
            </div>
            <div
              v-if="backupResult"
              class="ctv:py-1 ctv:px-1.5 ctv:rounded ctv:break-all"
              :class="backupResult.ok
                ? 'ctv:bg-emerald-500/10 ctv:text-emerald-400'
                : 'ctv:bg-destructive-background/15 ctv:text-destructive-background'"
            >
              <template v-if="backupResult.ok">
                ✓ {{ $t('settings.backup.ok', { path: backupResult.path ?? '' }) }}
              </template>
              <template v-else>
                ✗ {{ $t('settings.backup.failed', { error: backupResult.error ?? '' }) }}
              </template>
            </div>
          </div>
          <div v-if="s.id === 'agent' && skillsVisible && !query" class="ctv:px-2 ctv:py-1">
            <SkillsSection
              :active="props.active"
              :collapsed="isCollapsed('skills')"
              @toggle="toggleCollapsed('skills')"
            />
          </div>
        </SettingsSection>

        <SettingsSection
          v-if="ignisVisible"
          :section="{ id: 'ignis', master: null, rows: [], experimental: false, dirty: false, probe: null }"
          :title="$t('settings.ignis.section')"
          :collapsed="isCollapsed('ignis')"
          :master-on="false"
          @toggle="toggleCollapsed('ignis')"
        >
          <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:px-2 ctv:py-1.5">
            <div class="ctv:flex ctv:flex-col ctv:gap-1.5">
              <div class="ctv:text-2xs ctv:text-muted-foreground ctv:leading-relaxed">
                {{ $t('settings.ignis.configDesc') }}
              </div>
              <div
                class="ctv:text-2xs"
                :class="ignisConfigured ? 'ctv:text-emerald-400' : 'ctv:text-amber-400'"
              >
                {{ ignisConfigured
                  ? $t('settings.ignis.configured', { hint: ignisHint || '••••' })
                  : $t('settings.ignis.missing') }}
              </div>
              <ComfyTVText
                :model-value="ignisConfigInput"
                :placeholder="$t('settings.ignis.configPlaceholder')"
                :disabled="ignisSaving"
                multiline
                :rows="3"
                @update:model-value="(v: string) => ignisConfigInput = v"
              />
              <div>
                <button
                  :class="chipBtnClass"
                  :disabled="ignisSaving || !ignisConfigInput.trim()"
                  @click="saveIgnisConfigValue"
                >
                  {{ ignisSaving ? $t('settings.ignis.importing') : $t('settings.ignis.importConfig') }}
                </button>
              </div>
              <div v-if="ignisError" class="ctv:text-2xs ctv:text-destructive-background">
                {{ ignisError }}
              </div>
              <div v-else-if="ignisFlash" class="ctv:text-2xs ctv:text-emerald-400">
                {{ ignisFlash }}
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          v-if="teamGitVisible"
          :section="{ id: 'teamGit', master: null, rows: [], experimental: false, dirty: false, probe: null }"
          :title="$t('settings.teamGit.section')"
          :collapsed="isCollapsed('teamGit')"
          :master-on="false"
          @toggle="toggleCollapsed('teamGit')"
        >
          <div class="ctv:flex ctv:flex-col ctv:gap-1.5 ctv:px-2 ctv:py-1.5">
            <div class="ctv:text-2xs ctv:text-muted-foreground ctv:leading-relaxed">
              {{ $t('settings.teamGit.desc') }}
            </div>
            <div class="ctv:text-2xs" :class="teamGitConfigured ? 'ctv:text-emerald-400' : 'ctv:text-amber-400'">
              {{ teamGitConfigured
                ? $t('settings.teamGit.configured', { hint: teamGitHint || '••••' })
                : $t('settings.teamGit.missing') }}
            </div>
            <input
              class="ctv-text-input ctv:w-full ctv:box-border"
              type="password"
              autocomplete="off"
              :value="teamGitInput"
              :placeholder="$t('settings.teamGit.placeholder')"
              @input="teamGitInput = ($event.target as HTMLInputElement).value"
            >
            <div class="ctv:flex ctv:items-center ctv:gap-1.5">
              <button
                :class="chipBtnClass"
                :disabled="teamGitSaving || !teamGitInput.trim()"
                @click="saveTeamGitToken"
              >
                {{ teamGitSaving ? $t('settings.saving') : $t('settings.teamGit.save') }}
              </button>
              <span v-if="teamGitError" class="ctv:text-2xs ctv:text-destructive-background">{{ teamGitError }}</span>
              <span v-else-if="teamGitFlash" class="ctv:text-2xs ctv:text-emerald-400">{{ teamGitFlash }}</span>
            </div>
          </div>
        </SettingsSection>

        <div
          v-if="!sections.length && !teamGitVisible && !ignisVisible && !pluginUpdateVisible"
          class="ctv:py-5 ctv:px-1.5 ctv:text-center ctv:italic ctv:text-muted-foreground/60"
        >
          {{ $t('settings.noMatch') }}
        </div>
      </template>

      <div class="ctv:mt-auto ctv:pt-2 ctv:px-1 ctv:text-2xs ctv:text-muted-foreground/70 ctv:leading-relaxed">
        {{ $t('settings.hint') }}
      </div>
    </div>
  </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { useI18n } from 'vue-i18n'

import {
  fetchIgnisToken,
  fetchNativeWorkflowGitToken,
  saveIgnisConfigText,
  saveNativeWorkflowGitToken,
} from '@/api'
import SettingItem from '@/components/sidebar/SettingItem.vue'
import PluginUpdateSettings from '@/components/sidebar/PluginUpdateSettings.vue'
import SettingsSection from '@/components/sidebar/SettingsSection.vue'
import SkillsSection from '@/components/sidebar/SkillsSection.vue'
import ComfyTVText from '@/components/widgets/ComfyTVText.vue'
import { depthOf, useSettingsPanel } from '@/composables/sidebar/useSettingsPanel'
import type { SettingSection } from '@/composables/sidebar/useSettingsPanel'

import IconSearch from '~icons/lucide/search'

const props = defineProps<{ active?: boolean }>()

const { t } = useI18n()

const {
  rows,
  values,
  query,
  sections,
  skillsVisible,
  loading,
  saving,
  backingUp,
  error,
  dirty,
  dirtyCount,
  backupResult,
  isCollapsed,
  toggleCollapsed,
  setValue,
  save,
  backupNow,
  modelSuggestions,
} = useSettingsPanel(
  () => props.active,
  (key) => `${t(`settings.fields.${key}.label`)} ${t(`settings.fields.${key}.desc`)}`,
)

const teamGitConfigured = ref(false)
const teamGitHint = ref('')
const teamGitInput = ref('')
const teamGitSaving = ref(false)
const teamGitError = ref('')
const teamGitFlash = ref('')
const ignisConfigInput = ref('')
const ignisConfigured = ref(false)
const ignisHint = ref('')
const ignisSaving = ref(false)
const ignisError = ref('')
const ignisFlash = ref('')

const ignisVisible = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return [
    t('settings.ignis.section'),
    t('settings.ignis.configDesc'),
    t('settings.ignis.importConfig'),
    'ignis',
    'token',
    'config',
  ].join(' ').toLowerCase().includes(q)
})

const teamGitVisible = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  const blob = [
    t('settings.teamGit.section'),
    t('settings.teamGit.desc'),
    t('settings.teamGit.save'),
    'token',
    'git',
    'pat',
  ].join(' ').toLowerCase()
  return blob.includes(q)
})

const pluginUpdateSection: SettingSection = {
  id: 'pluginUpdate',
  master: null,
  rows: [],
  experimental: false,
  dirty: false,
  probe: null,
}

const pluginUpdateVisible = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return [
    t('settings.pluginUpdate.section'),
    t('settings.pluginUpdate.desc'),
    t('settings.pluginUpdate.check'),
    'comfytv',
    'github',
    'git',
  ].join(' ').toLowerCase().includes(q)
})

async function refreshTeamGitToken() {
  try {
    const res = await fetchNativeWorkflowGitToken()
    teamGitConfigured.value = !!res.configured
    teamGitHint.value = res.hint || ''
  } catch {
    /* keep last known */
  }
}

async function refreshIgnisToken() {
  try {
    const res = await fetchIgnisToken()
    ignisConfigured.value = !!res.configured
    ignisHint.value = res.hint || ''
  } catch {
    /* keep last known */
  }
}

async function saveIgnisConfigValue() {
  const text = ignisConfigInput.value.trim()
  if (!text) return
  ignisSaving.value = true
  ignisError.value = ''
  ignisFlash.value = ''
  try {
    const res = await saveIgnisConfigText(text)
    if (!res.ok) {
      ignisError.value = res.error || t('settings.ignis.importFailed')
      return
    }
    ignisConfigured.value = !!res.configured
    ignisHint.value = res.hint || ''
    ignisConfigInput.value = ''
    ignisFlash.value = t('settings.ignis.importOk')
  } catch (e: any) {
    ignisError.value = String(e?.message || e)
  } finally {
    ignisSaving.value = false
  }
}

async function saveTeamGitToken() {
  const token = teamGitInput.value.trim()
  if (!token) return
  teamGitSaving.value = true
  teamGitError.value = ''
  teamGitFlash.value = ''
  try {
    const res = await saveNativeWorkflowGitToken(token)
    if (!res.ok) {
      teamGitError.value = res.error || t('settings.teamGit.saveFailed')
      return
    }
    teamGitConfigured.value = !!res.configured
    teamGitHint.value = res.hint || ''
    teamGitInput.value = ''
    teamGitFlash.value = t('settings.teamGit.saveOk')
  } catch (e: any) {
    teamGitError.value = String(e?.message || e)
  } finally {
    teamGitSaving.value = false
  }
}

watch(
  () => props.active,
  (on) => {
    if (on) {
      void refreshTeamGitToken()
      void refreshIgnisToken()
    }
  },
  { immediate: true },
)

const primaryBtnClass = 'ctv:shrink-0 ctv:inline-flex ctv:items-center ctv:gap-1 ctv:cursor-pointer ctv:[font-family:inherit] '
  + 'ctv:rounded-lg ctv:border-none ctv:px-2 ctv:py-1 ctv:text-xs '
  + 'ctv:bg-interface-menu-component-surface-hovered ctv:text-base-foreground ctv:hover:brightness-110 '
  + 'ctv:disabled:opacity-50 ctv:disabled:pointer-events-none'
const chipBtnClass = 'ctv:inline-flex ctv:items-center ctv:cursor-pointer ctv:[font-family:inherit] '
  + 'ctv:rounded-lg ctv:border ctv:border-border-subtle ctv:bg-transparent ctv:px-2 ctv:py-1 ctv:text-xs '
  + 'ctv:text-base-foreground ctv:hover:bg-secondary-background-hover '
  + 'ctv:disabled:opacity-50 ctv:disabled:pointer-events-none'
</script>
