import { markRaw } from 'vue'

import { fetchPluginUpdateStatus, type PluginUpdateStatus } from '@/api'
import PluginUpdateDialog from '@/components/dialog/PluginUpdateDialog.vue'
import PluginUpdateRestartDialog from '@/components/dialog/PluginUpdateRestartDialog.vue'
import { i18n } from '@/i18n'
import { useDialogStore } from '@/stores/dialogStore'

const DISMISS_KEY = 'comfytv.pluginUpdate.dismissedRemoteSha'

function dismissedSha(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) || ''
  } catch {
    return ''
  }
}

function setDismissedSha(sha: string) {
  try {
    if (sha) localStorage.setItem(DISMISS_KEY, sha)
    else localStorage.removeItem(DISMISS_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

function showUpdateDialog(status: PluginUpdateStatus): Promise<'later' | 'dismiss' | 'updated' | 'failed'> {
  const dialog = useDialogStore()
  return new Promise((resolve) => {
    let settled = false
    const done = (action: 'later' | 'dismiss' | 'updated' | 'failed') => {
      if (settled) return
      settled = true
      resolve(action)
      dialog.close()
    }
    dialog.show({
      title: i18n.global.t('pluginUpdate.title'),
      width: '480px',
      component: markRaw(PluginUpdateDialog),
      props: {
        status,
        onResolve: done,
      },
    })
  })
}

function showRestartDialog(): void {
  const dialog = useDialogStore()
  dialog.show({
    title: i18n.global.t('pluginUpdate.restartTitle'),
    width: '420px',
    component: markRaw(PluginUpdateRestartDialog),
    props: {
      onResolve: () => dialog.close(),
    },
  })
}

/** Startup check: modal when origin is ahead of the local plugin checkout. */
export function installPluginUpdateCheck(): void {
  void (async () => {
    let status: PluginUpdateStatus
    try {
      status = await fetchPluginUpdateStatus(true)
    } catch (e) {
      console.warn('[ComfyTV] plugin update check failed', e)
      return
    }
    if (!status.ok || !status.update_available) return
    const remoteKey = status.remote_sha || status.remote_version || ''
    if (remoteKey && remoteKey === dismissedSha()) return

    const action = await showUpdateDialog(status)
    if (action === 'dismiss' && remoteKey) setDismissedSha(remoteKey)
    if (action === 'updated') {
      setDismissedSha('')
      const appAny = (window as any).app
      appAny?.extensionManager?.toast?.add?.({
        severity: 'success',
        summary: i18n.global.t('pluginUpdate.restartTitle'),
        detail: i18n.global.t('pluginUpdate.restartDetail'),
        life: 12000,
      })
      showRestartDialog()
    }
  })()
}
