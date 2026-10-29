<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'

import {
  fetchNativeWorkflowGitStatus,
  fetchNativeWorkflowGitToken,
  pullNativeWorkflowGit,
  pushNativeWorkflowGit,
  saveNativeWorkflowGitToken,
  setupNativeWorkflowGit,
  type NativeWorkflow,
  type NativeWorkflowGitStatus,
} from '@/api'
import { app } from '@/lib/comfyApp'

import IconImages from '~icons/lucide/images'
import IconPlus from '~icons/lucide/plus'
import IconSearch from '~icons/lucide/search'
import IconWorkflow from '~icons/lucide/workflow'
import IconX from '~icons/lucide/x'

import {
  QUICK_CREATE,
  SEARCH_CATEGORY_IDS,
  filterNodes,
  groupNodesByCategory,
  listBottomBarWorkflows,
  listComfyTVNodes,
  nativeWorkflowFolder,
  openWorkflowRow,
  spawnStageAtCenter,
  type NodeCatalogEntry,
  type SearchCategoryId,
} from './actions'
import AssetsPopup from './AssetsPopup.vue'

type Panel = 'plus' | 'workflows' | 'search' | 'assets' | null

const { t } = useI18n()

const root = ref<HTMLElement | null>(null)
const panel = ref<Panel>(null)
const searchQ = ref('')
const searchCat = ref<SearchCategoryId | 'all'>('all')
const searchInput = ref<HTMLInputElement | null>(null)
const catalog = ref<NodeCatalogEntry[]>([])
const catalogLoading = ref(false)
const workflows = ref<NativeWorkflow[]>([])
const workflowsLoading = ref(false)
const workflowError = ref('')
const openingPath = ref<string | null>(null)

const gitStatus = ref<NativeWorkflowGitStatus | null>(null)
const gitBusy = ref<'pull' | 'push' | 'setup' | null>(null)
const gitChecking = ref(false)
const gitMessage = ref('')
const gitFlash = ref('')
const commitPickOpen = ref(false)
const commitSelected = ref<Record<string, boolean>>({})
const tokenDialogOpen = ref(false)
const tokenInput = ref('')
const tokenSaving = ref(false)
const tokenError = ref('')
let tokenDialogResolve: ((ok: boolean) => void) | null = null

function toast(severity: 'success' | 'warn' | 'error', summary: string, detail = '') {
  ;(app as any)?.extensionManager?.toast?.add?.({ severity, summary, detail, life: 5000 })
}

function isGitAuthFailure(res: Pick<NativeWorkflowGitStatus, 'error' | 'error_code' | 'fetch_error'>): boolean {
  if (res.error_code === 'auth_failed') return true
  const text = `${res.error || ''} ${res.fetch_error || ''}`.toLowerCase()
  return (
    text.includes('authentication failed') ||
    text.includes('invalid username or token') ||
    text.includes('password authentication is not supported') ||
    text.includes('token invalid or expired')
  )
}

async function ensureGitTokenConfigured(force = false): Promise<boolean> {
  if (!force) {
    try {
      const st = await fetchNativeWorkflowGitToken()
      if (st.configured) return true
    } catch {
      /* fall through to dialog */
    }
  }
  tokenInput.value = ''
  tokenError.value = force ? t('v2.bottomBar.gitAuthFailed') : ''
  tokenDialogOpen.value = true
  return await new Promise<boolean>((resolve) => {
    tokenDialogResolve = resolve
  })
}

function closeTokenDialog(ok: boolean) {
  tokenDialogOpen.value = false
  tokenSaving.value = false
  const resolve = tokenDialogResolve
  tokenDialogResolve = null
  resolve?.(ok)
}

async function onTokenDialogSave() {
  const token = tokenInput.value.trim()
  if (!token) {
    tokenError.value = t('v2.bottomBar.gitTokenRequired')
    return
  }
  tokenSaving.value = true
  tokenError.value = ''
  try {
    const res = await saveNativeWorkflowGitToken(token)
    if (!res.ok || !res.configured) {
      tokenError.value = res.error || t('v2.bottomBar.gitTokenSaveFailed')
      return
    }
    if (gitStatus.value) gitStatus.value = { ...gitStatus.value, token_configured: true }
    closeTokenDialog(true)
  } catch (e: any) {
    tokenError.value = String(e?.message || e)
  } finally {
    tokenSaving.value = false
  }
}

const gitHint = computed(() => {
  const g = gitStatus.value
  if (!g) return gitChecking.value ? t('v2.bottomBar.gitChecking') : ''
  if (!g.has_git) return t('v2.bottomBar.gitNoGit')
  if (!g.is_repo) return t('v2.bottomBar.gitNoRepo')
  if (isGitAuthFailure(g)) return t('v2.bottomBar.gitAuthFailed')
  if (g.error && !g.ok) return g.error
  if (g.behind > 0) return t('v2.bottomBar.gitBehind', { n: g.behind })
  if (g.dirty) return t('v2.bottomBar.gitDirty')
  return t('v2.bottomBar.gitSynced')
})

const gitHintTone = computed(() => {
  const g = gitStatus.value
  if (!g?.is_repo || !g.has_git) return 'warn'
  if (g && isGitAuthFailure(g)) return 'warn'
  if (g.behind > 0 || g.dirty) return 'accent'
  return 'muted'
})

const canGitActions = computed(() => !!gitStatus.value?.is_repo && !gitBusy.value)
const canGitSetup = computed(
  () => !!gitStatus.value?.has_git && !gitStatus.value?.is_repo && !gitBusy.value,
)

const selectedCommitPaths = computed(() =>
  Object.entries(commitSelected.value)
    .filter(([, on]) => on)
    .map(([path]) => path),
)

type GitBadge = { key: string; label: string }

function gitBadgesForFile(f: NativeWorkflowGitStatus['files'][number]): GitBadge[] {
  const badges: GitBadge[] = []
  if (f.state === 'synced') return badges
  if (f.untracked || f.state === 'new') {
    badges.push({ key: 'new', label: t('v2.bottomBar.gitStateNew') })
  } else if (f.dirty || f.state === 'modified' || f.state === 'diverged') {
    badges.push({ key: 'modified', label: t('v2.bottomBar.gitStateModified') })
  }
  if (f.remote_diff || f.state === 'outdated' || f.state === 'diverged') {
    badges.push({ key: 'outdated', label: t('v2.bottomBar.gitStateOutdated') })
  }
  return badges
}

const gitBadgesByPath = computed(() => {
  const map = new Map<string, GitBadge[]>()
  for (const f of gitStatus.value?.files || []) map.set(f.path, gitBadgesForFile(f))
  return map
})

function gitBadgesFor(path: string): GitBadge[] {
  return gitBadgesByPath.value.get(path) || []
}

function workflowLocallyChanged(path: string): boolean {
  return gitBadgesFor(path).some((b) => b.key === 'new' || b.key === 'modified')
}

/** Cloud templates = paths present on remote tip; everything else is local-only. */
const remoteTemplateSet = computed(() => {
  const fromStatus = gitStatus.value?.remote_workflows
  if (fromStatus?.length) return new Set(fromStatus)
  const fromFiles = new Set<string>()
  for (const f of gitStatus.value?.files || []) {
    if (f.kind === 'template') fromFiles.add(f.path)
  }
  return fromFiles
})

const templateWorkflows = computed(() => {
  const remote = remoteTemplateSet.value
  if (!remote.size) {
    // No remote catalog yet — show nothing on the left until connected/fetched
    return [] as NativeWorkflow[]
  }
  const byPath = new Map(workflows.value.map((w) => [w.path, w]))
  const rows: NativeWorkflow[] = []
  for (const path of remote) {
    const existing = byPath.get(path)
    if (existing) {
      rows.push(existing)
      continue
    }
    const name = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.json$/i, '') || path
    rows.push({
      path,
      name,
      mtime: 0,
      size: 0,
      is_linked: false,
      linked_id: null,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
})

const localWorkflows = computed(() => {
  const remote = remoteTemplateSet.value
  return workflows.value.filter((w) => !remote.has(w.path))
})

const dirtyTemplates = computed(() =>
  templateWorkflows.value.filter((row) => workflowLocallyChanged(row.path)),
)

/** Edited cloud templates, then every local-only workflow. */
const commitCandidates = computed(() => {
  const seen = new Set<string>()
  const rows: NativeWorkflow[] = []
  for (const row of [...dirtyTemplates.value, ...localWorkflows.value]) {
    if (seen.has(row.path)) continue
    seen.add(row.path)
    rows.push(row)
  }
  return rows
})

const filtered = computed(() => filterNodes(catalog.value, searchQ.value, searchCat.value))

const searchGrouped = computed(() => {
  const list = filtered.value
  if (searchCat.value !== 'all') {
    return list.length
      ? [{ id: searchCat.value, labelKey: `v2.bottomBar.cat.${searchCat.value}`, nodes: list }]
      : []
  }
  return groupNodesByCategory(list)
})

onClickOutside(root, (ev) => {
  const target = ev.target as HTMLElement | null
  // Assets popup + menus teleport to body — treat as inside the bar.
  if (target?.closest?.(
    '[data-comfytv-assets-popup], .p-contextmenu, .p-dialog, .p-overlaypanel, [data-comfytv-portal]',
  )) return
  panel.value = null
})

watch(panel, async (next) => {
  if (next === 'search') {
    searchCat.value = 'all'
    if (!catalog.value.length && !catalogLoading.value) {
      catalogLoading.value = true
      try {
        catalog.value = await listComfyTVNodes()
      } finally {
        catalogLoading.value = false
      }
    }
    requestAnimationFrame(() => searchInput.value?.focus())
  }
  if (next === 'workflows') {
    gitFlash.value = ''
    commitPickOpen.value = false
    commitSelected.value = {}
    void refreshWorkflowsPanel()
  }
})

async function refreshGitStatusInBackground() {
  gitChecking.value = true
  try {
    // 1) Local porcelain only — badges for 未提交/已改动, no network
    const local = await fetchNativeWorkflowGitStatus(false).catch(() => null)
    if (local) gitStatus.value = local

    // New multi-user account: empty library + no .git → auto-clone team repo once.
    if (
      local?.has_git
      && !local.is_repo
      && workflows.value.length === 0
      && !gitBusy.value
    ) {
      gitBusy.value = 'setup'
      try {
        const setup = await setupNativeWorkflowGit()
        gitStatus.value = setup
        if (setup.ok && setup.is_repo) {
          gitFlash.value = t('v2.bottomBar.gitConnectOk')
          workflows.value = await listBottomBarWorkflows()
        }
      } catch {
        /* keep Connect button available */
      } finally {
        gitBusy.value = null
      }
    }

    // 2) Then silent fetch for 可更新 / behind
    const remote = await fetchNativeWorkflowGitStatus(true).catch(() => null)
    if (remote) gitStatus.value = remote
    if (remote && isGitAuthFailure(remote) && !tokenDialogOpen.value) {
      void ensureGitTokenConfigured(true)
      return
    }

    // Cloud templates behind → overwrite locally without asking
    if (
      remote?.ok
      && remote.is_repo
      && remote.behind > 0
      && !gitBusy.value
      && panel.value === 'workflows'
    ) {
      void onGitUpdate()
    }
  } finally {
    gitChecking.value = false
  }
}

async function refreshWorkflowsPanel() {
  workflowsLoading.value = true
  workflowError.value = ''
  try {
    // Show the local library immediately; do not wait on git fetch.
    workflows.value = await listBottomBarWorkflows()
  } catch (e: any) {
    workflowError.value = String(e?.message || e)
    workflows.value = []
  } finally {
    workflowsLoading.value = false
  }
  void refreshGitStatusInBackground()
}

async function onGitSetup() {
  if (!canGitSetup.value) return
  const tokOk = await ensureGitTokenConfigured()
  if (!tokOk) return
  gitBusy.value = 'setup'
  gitFlash.value = ''
  commitPickOpen.value = false
  try {
    const res = await setupNativeWorkflowGit()
    gitStatus.value = res
    if (!res.ok || !res.is_repo) {
      toast('error', t('v2.bottomBar.gitError'), gitErrorDetail(res))
      await promptTokenIfAuthFailed(res)
      return
    }
    gitFlash.value = t('v2.bottomBar.gitConnectOk')
    toast('success', t('v2.bottomBar.gitConnectOk'))
    workflows.value = await listBottomBarWorkflows()
  } catch (e: any) {
    toast('error', t('v2.bottomBar.gitError'), String(e?.message || e))
  } finally {
    gitBusy.value = null
  }
}

function gitErrorDetail(res: NativeWorkflowGitStatus): string {
  const code = res.error_code || ''
  if (code === 'auth_failed' || isGitAuthFailure(res)) return t('v2.bottomBar.gitAuthFailed')
  if (code === 'need_update') return t('v2.bottomBar.gitNeedUpdate')
  if (code === 'need_update_after_commit') return t('v2.bottomBar.gitNeedUpdateAfterCommit')
  if (code === 'pull_conflict') return t('v2.bottomBar.gitPullConflict')
  if (code === 'nothing_to_commit') return t('v2.bottomBar.gitNothingToCommit')
  const dups = (res.duplicates || []).join(', ')
  if (dups) return `${t('v2.bottomBar.gitDuplicate')}: ${dups}`
  return res.error || ''
}

async function promptTokenIfAuthFailed(res: NativeWorkflowGitStatus): Promise<void> {
  if (!isGitAuthFailure(res)) return
  await ensureGitTokenConfigured(true)
}

async function onGitUpdate() {
  if (!canGitActions.value) return
  const tokOk = await ensureGitTokenConfigured()
  if (!tokOk) return
  gitBusy.value = 'pull'
  gitFlash.value = ''
  commitPickOpen.value = false
  try {
    const res = await pullNativeWorkflowGit()
    gitStatus.value = res
    if (!res.ok) {
      toast('error', t('v2.bottomBar.gitError'), gitErrorDetail(res))
      await promptTokenIfAuthFailed(res)
      return
    }
    gitFlash.value = t('v2.bottomBar.gitPullOk')
    const restored = res.assets_restored || 0
    toast(
      'success',
      t('v2.bottomBar.gitPullOk'),
      restored > 0 ? t('v2.bottomBar.gitAssetsRestored', { n: restored }) : '',
    )
    const backups = res.local_backups || []
    if (backups.length) {
      toast(
        'warn',
        t('v2.bottomBar.gitPullLocalBackup', { names: backups.slice(0, 5).join(', ') }),
        '',
      )
    }
    if (res.assets_warnings?.length) {
      toast('warn', t('v2.bottomBar.gitAssetsWarn'), res.assets_warnings.slice(0, 3).join(' · '))
    }
    workflows.value = await listBottomBarWorkflows()
  } catch (e: any) {
    toast('error', t('v2.bottomBar.gitError'), String(e?.message || e))
  } finally {
    gitBusy.value = null
  }
}

async function openCommitPicker() {
  if (!canGitActions.value) return
  const ok = await ensureGitTokenConfigured()
  if (!ok) return
  commitPickOpen.value = true
  const next: Record<string, boolean> = {}
  for (const row of commitCandidates.value) {
    next[row.path] = workflowLocallyChanged(row.path)
  }
  commitSelected.value = next
}

function closeCommitPicker() {
  commitPickOpen.value = false
}

async function onGitCommitConfirm() {
  if (!canGitActions.value) return
  const paths = selectedCommitPaths.value
  if (!paths.length) {
    toast('warn', t('v2.bottomBar.gitNothingSelected'))
    return
  }
  gitBusy.value = 'push'
  gitFlash.value = ''
  try {
    const res = await pushNativeWorkflowGit(paths, gitMessage.value.trim())
    gitStatus.value = res
    if (!res.ok) {
      toast('error', t('v2.bottomBar.gitError'), gitErrorDetail(res))
      await promptTokenIfAuthFailed(res)
      return
    }
    gitFlash.value = t('v2.bottomBar.gitPushOk')
    gitMessage.value = ''
    commitPickOpen.value = false
    const packed = res.assets_packed || 0
    toast(
      'success',
      t('v2.bottomBar.gitPushOk'),
      packed > 0 ? t('v2.bottomBar.gitAssetsPacked', { n: packed }) : '',
    )
    if (res.assets_warnings?.length) {
      toast('warn', t('v2.bottomBar.gitAssetsWarn'), res.assets_warnings.slice(0, 3).join(' · '))
    }
    workflows.value = await listBottomBarWorkflows()
  } catch (e: any) {
    toast('error', t('v2.bottomBar.gitError'), String(e?.message || e))
  } finally {
    gitBusy.value = null
  }
}

function toggle(next: Panel) {
  panel.value = panel.value === next ? null : next
}

function onCreate(classType: string) {
  spawnStageAtCenter(classType)
  panel.value = null
}

async function onOpenWorkflow(row: NativeWorkflow) {
  openingPath.value = row.path
  try {
    const ok = await openWorkflowRow(row)
    if (ok) panel.value = null
  } finally {
    openingPath.value = null
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && panel.value) {
    e.stopPropagation()
    panel.value = null
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div ref="root" class="ctv-bbar" data-testid="comfytv-bottom-bar">
    <AssetsPopup :open="panel === 'assets'" @close="panel = null" />

    <div v-if="panel === 'plus'" class="ctv-bbar__pop" role="menu" :aria-label="t('v2.bottomBar.add')">
      <button
        v-for="item in QUICK_CREATE"
        :key="item.id"
        type="button"
        class="ctv-bbar__row"
        role="menuitem"
        @click="onCreate(item.classType)"
      >
        {{ t(item.labelKey) }}
      </button>
    </div>

    <div
      v-else-if="panel === 'workflows'"
      class="ctv-bbar__pop ctv-bbar__pop--wide"
      role="dialog"
      :aria-label="t('v2.bottomBar.workflows')"
    >
      <div class="ctv-bbar__pop-head">{{ t('v2.bottomBar.workflows') }}</div>

      <div class="ctv-bbar__git">
        <div
          class="ctv-bbar__git-hint"
          :class="{
            'ctv-bbar__git-hint--accent': gitHintTone === 'accent',
            'ctv-bbar__git-hint--warn': gitHintTone === 'warn',
          }"
        >
          {{ gitBusy === 'pull' ? t('v2.bottomBar.gitUpdating')
            : gitBusy === 'push' ? t('v2.bottomBar.gitPushing')
              : gitBusy === 'setup' ? t('v2.bottomBar.gitConnecting')
                : gitChecking && !gitFlash ? (gitHint || t('v2.bottomBar.gitChecking'))
                  : (gitFlash || gitHint) }}
        </div>
        <div class="ctv-bbar__git-actions">
          <button
            v-if="canGitSetup || (gitStatus && !gitStatus.is_repo)"
            type="button"
            class="ctv-bbar__git-btn ctv-bbar__git-btn--primary"
            :disabled="!canGitSetup"
            @click="onGitSetup"
          >{{ t('v2.bottomBar.gitConnect') }}</button>
          <button
            type="button"
            class="ctv-bbar__git-btn"
            :disabled="!canGitActions"
            @click="onGitUpdate"
          >{{ t('v2.bottomBar.gitUpdate') }}</button>
          <button
            type="button"
            class="ctv-bbar__git-btn ctv-bbar__git-btn--primary"
            :disabled="!canGitActions || !commitCandidates.length"
            @click="openCommitPicker"
          >{{ t('v2.bottomBar.gitCommit') }}</button>
        </div>
        <div v-if="gitStatus?.is_repo" class="ctv-bbar__git-legend">{{ t('v2.bottomBar.gitLegend') }}</div>
      </div>

      <div v-if="tokenDialogOpen" class="ctv-bbar__commit">
        <div class="ctv-bbar__commit-head">{{ t('v2.bottomBar.gitTokenTitle') }}</div>
        <div class="ctv-bbar__git-legend">{{ t('v2.bottomBar.gitTokenHint') }}</div>
        <input
          v-model="tokenInput"
          type="password"
          class="ctv-bbar__git-input"
          autocomplete="off"
          :placeholder="t('v2.bottomBar.gitTokenPlaceholder')"
          :disabled="tokenSaving"
          @keydown.stop
          @keydown.enter.prevent="onTokenDialogSave"
        >
        <div v-if="tokenError" class="ctv-bbar__muted">{{ tokenError }}</div>
        <div class="ctv-bbar__git-actions">
          <button
            type="button"
            class="ctv-bbar__git-btn"
            :disabled="tokenSaving"
            @click="closeTokenDialog(false)"
          >{{ t('v2.bottomBar.gitCommitCancel') }}</button>
          <button
            type="button"
            class="ctv-bbar__git-btn ctv-bbar__git-btn--primary"
            :disabled="tokenSaving || !tokenInput.trim()"
            @click="onTokenDialogSave"
          >{{ tokenSaving ? t('v2.bottomBar.gitTokenSaving') : t('v2.bottomBar.gitTokenSave') }}</button>
        </div>
      </div>

      <div v-else-if="commitPickOpen" class="ctv-bbar__commit">
        <div class="ctv-bbar__commit-head">{{ t('v2.bottomBar.gitCommitPick') }}</div>
        <input
          v-model="gitMessage"
          type="text"
          class="ctv-bbar__git-input"
          :placeholder="t('v2.bottomBar.gitMessagePlaceholder')"
          :disabled="!!gitBusy"
          @keydown.stop
          @keydown.enter.prevent="onGitCommitConfirm"
        >
        <div class="ctv-bbar__commit-list">
          <label
            v-for="row in commitCandidates"
            :key="row.path"
            class="ctv-bbar__commit-item"
          >
            <input
              v-model="commitSelected[row.path]"
              type="checkbox"
              :disabled="!!gitBusy"
            >
            <span class="ctv-bbar__row-main">{{ row.name }}</span>
            <span v-if="remoteTemplateSet.has(row.path)" class="ctv-bbar__badge">
              {{ t('v2.bottomBar.templates') }}
            </span>
            <span
              v-for="b in gitBadgesFor(row.path)"
              :key="b.key"
              class="ctv-bbar__git-badge"
              :class="`ctv-bbar__git-badge--${b.key}`"
            >{{ b.label }}</span>
            <span v-if="nativeWorkflowFolder(row.path)" class="ctv-bbar__badge">
              {{ nativeWorkflowFolder(row.path) }}
            </span>
          </label>
          <div v-if="!commitCandidates.length" class="ctv-bbar__muted">
            {{ t('v2.bottomBar.localWorkflowsEmpty') }}
          </div>
        </div>
        <div class="ctv-bbar__git-actions">
          <button
            type="button"
            class="ctv-bbar__git-btn"
            :disabled="!!gitBusy"
            @click="closeCommitPicker"
          >{{ t('v2.bottomBar.gitCommitCancel') }}</button>
          <button
            type="button"
            class="ctv-bbar__git-btn ctv-bbar__git-btn--primary"
            :disabled="!!gitBusy || !selectedCommitPaths.length"
            @click="onGitCommitConfirm"
          >{{ t('v2.bottomBar.gitCommitConfirm') }}</button>
        </div>
      </div>

      <div v-if="workflowsLoading" class="ctv-bbar__muted">{{ t('v2.bottomBar.workflowLoading') }}</div>
      <div v-else-if="workflowError" class="ctv-bbar__muted">{{ workflowError }}</div>
      <div
        v-else-if="!templateWorkflows.length && !localWorkflows.length"
        class="ctv-bbar__muted"
      >{{ t('v2.bottomBar.workflowEmpty') }}</div>
      <div v-else class="ctv-bbar__split">
        <div class="ctv-bbar__col">
          <div class="ctv-bbar__col-head">{{ t('v2.bottomBar.templates') }}</div>
          <div class="ctv-bbar__scroll ctv-bbar__scroll--col">
            <div v-if="!templateWorkflows.length" class="ctv-bbar__muted">
              {{ t('v2.bottomBar.templatesEmpty') }}
            </div>
            <button
              v-for="row in templateWorkflows"
              :key="`t-${row.path}`"
              type="button"
              class="ctv-bbar__row"
              :class="{
                'ctv-bbar__row--git-outdated': gitBadgesFor(row.path).some((b) => b.key === 'outdated'),
                'ctv-bbar__row--git-modified': gitBadgesFor(row.path).some((b) => b.key === 'modified'),
              }"
              :disabled="openingPath === row.path || row.mtime === 0"
              :title="row.path"
              @click="onOpenWorkflow(row)"
            >
              <span class="ctv-bbar__row-main">{{ row.name }}</span>
              <span
                v-for="b in gitBadgesFor(row.path)"
                :key="b.key"
                class="ctv-bbar__git-badge"
                :class="`ctv-bbar__git-badge--${b.key}`"
              >{{ b.label }}</span>
            </button>
          </div>
        </div>
        <div class="ctv-bbar__col">
          <div class="ctv-bbar__col-head">{{ t('v2.bottomBar.localWorkflows') }}</div>
          <div class="ctv-bbar__scroll ctv-bbar__scroll--col">
            <div v-if="!localWorkflows.length" class="ctv-bbar__muted">
              {{ t('v2.bottomBar.localWorkflowsEmpty') }}
            </div>
            <button
              v-for="row in localWorkflows"
              :key="`l-${row.path}`"
              type="button"
              class="ctv-bbar__row"
              :class="{
                'ctv-bbar__row--git-new': gitBadgesFor(row.path).some((b) => b.key === 'new'),
                'ctv-bbar__row--git-modified': gitBadgesFor(row.path).some((b) => b.key === 'modified'),
              }"
              :disabled="openingPath === row.path"
              :title="row.path"
              @click="onOpenWorkflow(row)"
            >
              <span class="ctv-bbar__row-main">{{ row.name }}</span>
              <span
                v-for="b in gitBadgesFor(row.path)"
                :key="b.key"
                class="ctv-bbar__git-badge"
                :class="`ctv-bbar__git-badge--${b.key}`"
              >{{ b.label }}</span>
              <span v-if="nativeWorkflowFolder(row.path)" class="ctv-bbar__badge">
                {{ nativeWorkflowFolder(row.path) }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-else-if="panel === 'search'"
      class="ctv-bbar__pop ctv-bbar__pop--wide"
      role="dialog"
      :aria-label="t('v2.bottomBar.search')"
    >
      <div class="ctv-bbar__search">
        <IconSearch class="ctv-bbar__search-icon" />
        <input
          ref="searchInput"
          v-model="searchQ"
          type="search"
          class="ctv-bbar__search-input"
          :placeholder="t('v2.bottomBar.searchPlaceholder')"
          autocomplete="off"
        >
        <button
          v-if="searchQ"
          type="button"
          class="ctv-bbar__icon-btn"
          :aria-label="t('dialog.close')"
          @click="searchQ = ''"
        >
          <IconX class="ctv:size-3.5" />
        </button>
      </div>
      <div class="ctv-bbar__cats" role="tablist" :aria-label="t('v2.bottomBar.categories')">
        <button
          type="button"
          role="tab"
          class="ctv-bbar__cat"
          :class="{ 'ctv-bbar__cat--on': searchCat === 'all' }"
          :aria-selected="searchCat === 'all'"
          @click="searchCat = 'all'"
        >
          {{ t('v2.bottomBar.cat.all') }}
        </button>
        <button
          v-for="cat in SEARCH_CATEGORY_IDS"
          :key="cat"
          type="button"
          role="tab"
          class="ctv-bbar__cat"
          :class="{ 'ctv-bbar__cat--on': searchCat === cat }"
          :aria-selected="searchCat === cat"
          @click="searchCat = cat"
        >
          {{ t(`v2.bottomBar.cat.${cat}`) }}
        </button>
      </div>
      <div v-if="catalogLoading" class="ctv-bbar__muted">{{ t('v2.bottomBar.workflowLoading') }}</div>
      <div v-else-if="!searchGrouped.length" class="ctv-bbar__muted">{{ t('v2.bottomBar.searchEmpty') }}</div>
      <div v-else class="ctv-bbar__scroll">
        <section v-for="group in searchGrouped" :key="group.id" class="ctv-bbar__group">
          <div v-if="searchCat === 'all'" class="ctv-bbar__group-head">{{ t(group.labelKey) }}</div>
          <button
            v-for="n in group.nodes"
            :key="n.classType"
            type="button"
            class="ctv-bbar__row"
            @click="onCreate(n.classType)"
          >
            <span class="ctv-bbar__row-main">{{ n.label }}</span>
          </button>
        </section>
      </div>
    </div>

    <div class="ctv-bbar__pill" role="toolbar" :aria-label="t('v2.bottomBar.add')">
      <button
        type="button"
        class="ctv-bbar__btn ctv-bbar__btn--plus"
        :aria-label="t('v2.bottomBar.add')"
        :aria-expanded="panel === 'plus'"
        :title="t('v2.bottomBar.add')"
        @click="toggle('plus')"
      >
        <IconPlus class="ctv:size-4" />
      </button>

      <span class="ctv-bbar__sep" aria-hidden="true" />

      <button
        type="button"
        class="ctv-bbar__btn"
        :aria-label="t('v2.bottomBar.assets')"
        :aria-expanded="panel === 'assets'"
        :title="t('v2.bottomBar.assets')"
        @click="toggle('assets')"
      >
        <IconImages class="ctv:size-4" />
        <span class="ctv-bbar__btn-label">{{ t('v2.bottomBar.assets') }}</span>
      </button>

      <span class="ctv-bbar__sep" aria-hidden="true" />

      <button
        type="button"
        class="ctv-bbar__btn"
        :aria-label="t('v2.bottomBar.workflows')"
        :aria-expanded="panel === 'workflows'"
        :title="t('v2.bottomBar.workflows')"
        @click="toggle('workflows')"
      >
        <IconWorkflow class="ctv:size-4" />
        <span class="ctv-bbar__btn-label">{{ t('v2.bottomBar.workflows') }}</span>
      </button>

      <span class="ctv-bbar__sep" aria-hidden="true" />

      <button
        type="button"
        class="ctv-bbar__btn"
        :aria-label="t('v2.bottomBar.search')"
        :aria-expanded="panel === 'search'"
        :title="t('v2.bottomBar.search')"
        @click="toggle('search')"
      >
        <IconSearch class="ctv:size-4" />
        <span class="ctv-bbar__btn-label">{{ t('v2.bottomBar.search') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ctv-bbar {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 1200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: none;
  font-family: inherit;
}

.ctv-bbar__pill,
.ctv-bbar__pop {
  pointer-events: auto;
}

.ctv-bbar__pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #3a3a3a) 80%, transparent);
  background: color-mix(in srgb, var(--color-agent-surface, #1c1c1c) 88%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.ctv-bbar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--color-base-foreground, #f0f0f0);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.ctv-bbar__btn:hover,
.ctv-bbar__btn[aria-expanded='true'] {
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 10%, transparent);
}

.ctv-bbar__btn--plus {
  width: 34px;
  padding: 0;
  background: var(--color-base-foreground, #f5f5f5);
  color: #111;
}

.ctv-bbar__btn--plus:hover {
  background: #fff;
}

.ctv-bbar__btn-label {
  line-height: 1;
}

.ctv-bbar__sep {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: color-mix(in srgb, var(--color-interface-stroke, #555) 70%, transparent);
}

.ctv-bbar__pop {
  min-width: 180px;
  max-width: min(360px, 80vw);
  padding: 8px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #3a3a3a) 80%, transparent);
  background: color-mix(in srgb, var(--color-agent-surface, #1c1c1c) 94%, transparent);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
  color: var(--color-base-foreground, #f0f0f0);
}

.ctv-bbar__pop--wide {
  width: min(360px, 88vw);
}

.ctv-bbar__pop--wide:has(.ctv-bbar__split) {
  width: min(640px, 94vw);
}

.ctv-bbar__split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  min-height: 0;
}

.ctv-bbar__col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 4%, transparent);
  padding: 4px;
}

.ctv-bbar__col-head {
  padding: 6px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.65;
  letter-spacing: 0.02em;
}

.ctv-bbar__scroll--col {
  max-height: min(42vh, 320px);
}

.ctv-bbar__cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  max-height: 72px;
  overflow-y: auto;
}

.ctv-bbar__cat {
  flex-shrink: 0;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #444) 55%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  opacity: 0.85;
}

.ctv-bbar__cat:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 8%, transparent);
}

.ctv-bbar__cat--on {
  opacity: 1;
  border-color: color-mix(in srgb, var(--color-base-foreground, #fff) 35%, transparent);
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 14%, transparent);
}

.ctv-bbar__group + .ctv-bbar__group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--color-interface-stroke, #444) 45%, transparent);
}

.ctv-bbar__group-head {
  padding: 2px 10px 6px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.55;
  text-transform: none;
}

.ctv-bbar__pop-head {
  padding: 4px 8px 8px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.85;
}

.ctv-bbar__git {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 8px;
  padding: 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 6%, transparent);
}

.ctv-bbar__git-hint {
  font-size: 11px;
  line-height: 1.35;
  opacity: 0.7;
}

.ctv-bbar__git-hint--accent {
  opacity: 1;
  color: #9ecbff;
}

.ctv-bbar__git-hint--warn {
  opacity: 1;
  color: #e6c07b;
}

.ctv-bbar__git-actions {
  display: flex;
  gap: 6px;
}

.ctv-bbar__git-legend {
  font-size: 10px;
  line-height: 1.35;
  opacity: 0.5;
}

.ctv-bbar__git-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
}

.ctv-bbar__git-badge--new {
  color: #1a1a1a;
  background: #e6c07b;
}

.ctv-bbar__git-badge--modified {
  color: #0b1b2b;
  background: #9ecbff;
}

.ctv-bbar__git-badge--outdated {
  color: #0b1f14;
  background: #7dcea0;
}

.ctv-bbar__git-btn {
  flex: 1;
  height: 28px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #555) 70%, transparent);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ctv-bbar__commit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 8px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #555) 55%, transparent);
}

.ctv-bbar__commit-head {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.8;
}

.ctv-bbar__commit-list {
  max-height: min(200px, 28vh);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctv-bbar__commit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
}

.ctv-bbar__commit-item:hover {
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 8%, transparent);
}

.ctv-bbar__commit-item input {
  flex-shrink: 0;
}

.ctv-bbar__git-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 10%, transparent);
}

.ctv-bbar__git-btn--primary {
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 14%, transparent);
  border-color: transparent;
}

.ctv-bbar__git-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ctv-bbar__git-input {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #555) 55%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-agent-surface, #121212) 80%, transparent);
  color: inherit;
  font: inherit;
  font-size: 12px;
  outline: none;
}

.ctv-bbar__git-input:focus {
  border-color: color-mix(in srgb, var(--color-base-foreground, #fff) 35%, transparent);
}

.ctv-bbar__git-input:disabled {
  opacity: 0.5;
}

.ctv-bbar__scroll {
  max-height: min(360px, 50vh);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctv-bbar__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
}

.ctv-bbar__row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 10%, transparent);
}

.ctv-bbar__row:disabled {
  opacity: 0.55;
  cursor: wait;
}

.ctv-bbar__row-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctv-bbar__badge {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.55;
  text-transform: lowercase;
}

.ctv-bbar__muted {
  padding: 12px 10px;
  font-size: 12px;
  opacity: 0.6;
}

.ctv-bbar__search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 6%, transparent);
}

.ctv-bbar__search-icon {
  width: 14px;
  height: 14px;
  opacity: 0.55;
  flex-shrink: 0;
}

.ctv-bbar__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
}

.ctv-bbar__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.ctv-bbar__icon-btn:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 10%, transparent);
}

@media (max-width: 720px) {
  .ctv-bbar__btn-label {
    display: none;
  }
  .ctv-bbar__btn {
    width: 34px;
    padding: 0;
  }
}
</style>
