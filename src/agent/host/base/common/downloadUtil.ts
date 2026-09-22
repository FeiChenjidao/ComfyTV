const DEFAULT_DOWNLOAD_FILENAME = 'download.png'

function triggerLinkDownload(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function extractFilenameFromUrl(url: string): string | null {
  try {
    return new URL(url, window.location.origin).searchParams.get('filename')
  } catch {
    return null
  }
}

export function extractFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const extended = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1])
    } catch {
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i)
  if (quoted?.[1]) return quoted[1]
  const unquoted = header.match(/filename=([^;\s]+)/i)
  return unquoted?.[1] ?? null
}

export function downloadFile(url: string, filename?: string): void {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('Invalid URL provided for download')
  }
  triggerLinkDownload(url, filename || extractFilenameFromUrl(url) || DEFAULT_DOWNLOAD_FILENAME)
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  triggerLinkDownload(url, filename)
  queueMicrotask(() => URL.revokeObjectURL(url))
}

export async function downloadFileAsBlob(
  url: string,
  {
    filename,
    fetch: fetchFile = fetch,
    preferResponseFilename = true,
  }: {
    filename?: string
    fetch?: (url: string) => Promise<Response>
    preferResponseFilename?: boolean
  } = {},
): Promise<void> {
  const fallback = filename || extractFilenameFromUrl(url) || DEFAULT_DOWNLOAD_FILENAME
  const response = await fetchFile(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const headerFilename = extractFilenameFromContentDisposition(
    response.headers.get('Content-Disposition'),
  )
  downloadBlob(preferResponseFilename ? (headerFilename ?? fallback) : fallback, await response.blob())
}

export async function openFileInNewTab(url: string): Promise<void> {
  window.open(url, '_blank')
}
