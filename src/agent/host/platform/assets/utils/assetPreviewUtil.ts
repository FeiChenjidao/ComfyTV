import { api } from '../../../scripts/api'
import { assetService } from '../services/assetService'

interface AssetRecord {
  id: string
  name: string
  hash?: string | null
  preview_url?: string
  preview_id?: string | null
}

export function isAssetPreviewSupported(): boolean {
  return assetService.isAssetAPIEnabled() || api.getServerFeature?.('assets', false) === true
}

async function fetchAssets(params: Record<string, string>): Promise<AssetRecord[]> {
  const query = new URLSearchParams(params)
  const res = await api.fetchApi(`/assets?${query}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.assets ?? []
}

export function resolvePreviewUrl(asset: AssetRecord): string {
  if (asset.preview_url) return api.apiURL(asset.preview_url)
  return api.apiURL(`/assets/${asset.preview_id ?? asset.id}/content`)
}

export async function findOutputAsset(name: string): Promise<AssetRecord | undefined> {
  const byHash = await fetchAssets({ hash: name })
  const hashMatch = byHash.find((a) => a.hash === name)
  if (hashMatch) return hashMatch
  const byName = await fetchAssets({ name_contains: name })
  return byName.find((a) => a.name === name)
}

export async function findServerPreviewUrl(name: string): Promise<string | null> {
  try {
    const asset = await findOutputAsset(name)
    if (!asset?.preview_id) return null
    return resolvePreviewUrl(asset)
  } catch {
    return null
  }
}
