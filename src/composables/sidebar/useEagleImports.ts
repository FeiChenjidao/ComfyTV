import { reactive } from 'vue'

import { importEagleItem } from '@/api/eagle'
import type { Asset } from '@/api/schemas'

const imported = reactive(new Map<string, Asset>())

export function importedEagleAsset(itemId: string): Asset | undefined {
  return imported.get(itemId)
}

export async function importEagleAsset(itemId: string): Promise<Asset> {
  const cached = imported.get(itemId)
  if (cached) return cached
  const res = await importEagleItem(itemId)
  if (!res.asset) throw new Error('eagle import returned no asset')
  imported.set(itemId, res.asset)
  return res.asset
}
