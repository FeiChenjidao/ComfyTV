let enabled = true

export function isAutoPickerEnabled(): boolean {
  return enabled
}

export function applyAutoPickerSetting(rows: Array<{ key: string; value: unknown }>): void {
  const row = rows.find((r) => r.key === 'auto-picker')
  if (row) enabled = row.value !== false
}
