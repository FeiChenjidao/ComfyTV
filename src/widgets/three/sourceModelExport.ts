import { app } from '@/lib/comfyApp'
import { downloadBlob, downloadFile, extractFilenameFromContentDisposition } from '@/utils/download'
import type { ModelExportFormat } from './modelExporter'
import { modelUrlExtension } from './modelFormats'

/** Return true when the source polygon file owns this export. */
export async function exportSourceModel(url: string, format: ModelExportFormat): Promise<boolean> {
  if (format !== 'fbx' && format !== 'obj') return false
  const extension = modelUrlExtension(url)
  if (extension !== '.fbx' && extension !== '.obj') return false
  if (extension === '.fbx' && format === 'fbx') {
    await downloadFile(url)
    return true
  }
  const query = new URLSearchParams({ url, format })
  const response = await app.api.fetchApi(`/comfytv/model/export_source?${query}`)
  if (!response.ok) {
    const detail = await response.json()
    throw new Error(detail.error || `Model export failed: HTTP ${response.status}`)
  }
  const filename = extractFilenameFromContentDisposition(response.headers.get('Content-Disposition'))
  downloadBlob(filename || `model_${format}.zip`, await response.blob())
  return true
}
