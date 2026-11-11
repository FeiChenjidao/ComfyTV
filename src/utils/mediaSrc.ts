import { app } from '@/lib/comfyApp'

/**
 * Turn a stored media URL into something `<img src>` / `<video src>` /
 * `new Image().src` can actually load.
 *
 * Stage payloads store root-relative view URLs (`/view?filename=…`); the
 * ComfyUI server serves those behind its API prefix. `apiURL` adds that
 * prefix, so absolute / blob / data URLs pass through untouched.
 *
 * Returns null for empty input and for batch JSON (`{ images: [...] }`),
 * which is not a URL — unwrap it with `pickSourceImageUrl` first.
 */
export function resolveMediaSrc(url: string | null | undefined): string | null {
  const raw = String(url ?? '').trim()
  if (!raw || raw.startsWith('{')) return null
  // Absolute, blob: and data: URLs are already loadable as-is.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return raw
  const api = (app as any)?.api
  if (typeof api?.apiURL !== 'function') return raw
  return api.apiURL(raw.replace(/^\/api/, ''))
}
