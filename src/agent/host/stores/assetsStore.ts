import { hostStore } from '../pinia'

export function useAssetsStore() {
  return {
    inputAssets: {
      loadNew(): void {
        hostStore('assets')?.inputAssets?.loadNew?.()
      },
    },
  }
}
