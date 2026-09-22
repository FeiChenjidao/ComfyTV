import { api } from '../../../scripts/api'
import type { AssetItem } from '../schemas/assetSchema'

export const assetService = {
  isAssetAPIEnabled(): boolean {
    return api.getServerFeature?.('assets', false) === true
  },
  async getInputAssetsIncludingPublic(): Promise<AssetItem[]> {
    try {
      const res = await api.fetchApi('/assets?tags=input&limit=200')
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data?.assets) ? data.assets : []
    } catch {
      return []
    }
  },
}
