export const CLOSE_POPOVERS_EVENT = 'comfytv:close-popovers'

export function closeOpenPopovers(): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(new Event(CLOSE_POPOVERS_EVENT))
}
