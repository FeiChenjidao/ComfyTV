import { hostStore, hostVersion } from '../../../pinia'

export function useCanvasStore() {
  const version = hostVersion('canvas')
  const host = () => hostStore('canvas')
  return {
    get canvas(): any {
      version.value
      return host()?.canvas ?? null
    },
    get currentGraph(): any {
      version.value
      return host()?.currentGraph ?? null
    },
    get linearMode(): boolean {
      version.value
      return host()?.linearMode === true
    },
    get selectedItems(): any[] {
      version.value
      return host()?.selectedItems ?? []
    },
    updateSelectedItems(): void {
      host()?.updateSelectedItems?.()
    },
  }
}
