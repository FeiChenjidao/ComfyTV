export interface ResultItem {
  filename?: string
  subfolder?: string
  type?: 'input' | 'output' | 'temp'
  display_name?: string
  [key: string]: unknown
}
