/** Close the floating assets popup (e.g. when dragging an asset to the canvas). */

export const ASSETS_POPUP_HIDE = 'comfytv:assets-popup-hide'

export function hideAssetsPopup(): void {
  window.dispatchEvent(new CustomEvent(ASSETS_POPUP_HIDE))
}
