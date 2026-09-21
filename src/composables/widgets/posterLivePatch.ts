import type { Rect } from '@/composables/stages/usePosterStage'

function frameElement(
  frame: HTMLIFrameElement | null,
  id: string,
  suffix = ''
): HTMLElement | null {
  const doc = frame?.contentDocument
  if (!doc) return null
  const key = (window.CSS && CSS.escape) ? CSS.escape(id) : id
  return doc.querySelector(`.pm-el[data-el="${key}"]${suffix}`) as HTMLElement | null
}

export function livePatchRect(
  frame: HTMLIFrameElement | null,
  id: string,
  e: Rect,
  refit: boolean
): void {
  try {
    const el = frameElement(frame, id)
    if (!el) return
    el.style.left = `${(e.x * 100).toFixed(3)}%`
    el.style.top = `${(e.y * 100).toFixed(3)}%`
    el.style.width = `${(e.w * 100).toFixed(3)}%`
    el.style.height = `${(e.h * 100).toFixed(3)}%`
    if (refit) {
      const fit = (frame?.contentWindow as any)?.__pmFit
      if (typeof fit === 'function') fit()
    }
  } catch {}
}

export function livePatchImg(
  frame: HTMLIFrameElement | null,
  id: string,
  p: { x: number; y: number; scale: number }
): void {
  try {
    const im = frameElement(frame, id, ' img')
    if (!im) return
    im.style.transform =
      `translate(${(p.x * 100).toFixed(3)}%,${(p.y * 100).toFixed(3)}%) scale(${p.scale})`
  } catch {}
}

export function livePatchRotate(
  frame: HTMLIFrameElement | null,
  id: string,
  deg: number
): void {
  try {
    const el = frameElement(frame, id)
    if (el) el.style.transform = deg ? `rotate(${deg.toFixed(3)}deg)` : ''
  } catch {}
}
