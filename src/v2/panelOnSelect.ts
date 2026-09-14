/** Hide V2 control panels unless the card is selected (plugin setting). */

export const PANEL_ON_SELECT_ATTR = 'data-v2-panel-on-select'
export const PANEL_ON_SELECT_SETTING = 'v2-panel-on-select'

export function applyPanelOnSelectSetting(
  rows: Array<{ key: string; value: unknown }>,
): void {
  const row = rows.find((r) => r.key === PANEL_ON_SELECT_SETTING)
  const on = row?.value === true
  document.body.toggleAttribute(PANEL_ON_SELECT_ATTR, on)
}

export function isPanelOnSelectEnabled(): boolean {
  return document.body.hasAttribute(PANEL_ON_SELECT_ATTR)
}
