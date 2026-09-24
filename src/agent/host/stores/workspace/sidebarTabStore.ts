import { hostManager } from '../../pinia'

export function useSidebarTabStore() {
  return {
    get activeSidebarTabId(): string | null {
      return hostManager()?.sidebarTab?.activeSidebarTabId ?? null
    },
    set activeSidebarTabId(id: string | null) {
      const tabs = hostManager()?.sidebarTab
      if (tabs) tabs.activeSidebarTabId = id
    },
  }
}
