export interface AssetItem {
  id: string
  name: string
  display_name?: string
  hash?: string | null
  tags?: string[]
  preview_url?: string
  preview_id?: string | null
  user_metadata?: Record<string, unknown>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}
