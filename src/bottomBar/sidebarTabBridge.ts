import { app } from '@/lib/comfyApp'

/** Shared bridge so the bottom bar can open a ComfyTV sidebar sub-tab. */

export const SIDEBAR_TAB_EVENT = 'comfytv:sidebar-tab'

export type ComfyTVSidebarTabId =
  | 'workflow'
  | 'assets'
  | 'eagle'
  | 'entries'
  | 'params'
  | 'presets'
  | 'resources'
  | 'servers'
  | 'collab'
  | 'settings'

const SIDEBAR_ID = 'comfytv-workflow-config'

export function setComfyTVSidebarTab(tab: ComfyTVSidebarTabId): void {
  try {
    localStorage.setItem('comfytv:sidebar:active-tab', JSON.stringify(tab))
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(SIDEBAR_TAB_EVENT, { detail: tab }))
}

export function openComfyTVSidebar(tab?: ComfyTVSidebarTabId): void {
  if (tab) setComfyTVSidebarTab(tab)
  const tabs = (app as any)?.extensionManager?.sidebarTab
  if (!tabs) return
  if (tabs.activeSidebarTabId === SIDEBAR_ID) return
  if (typeof tabs.toggleSidebarTab === 'function') {
    tabs.toggleSidebarTab(SIDEBAR_ID)
    return
  }
  tabs.activeSidebarTabId = SIDEBAR_ID
}
