type T = (key: string, values?: Record<string, unknown>) => string

export const SYSTEM_FONT = '(系统默认 System)'

export const sepClass = 'ctv:w-px ctv:h-4 ctv:bg-border-subtle ctv:mx-0.5 ctv:shrink-0'

export function btn(active: boolean): string {
  return 'ctv:appearance-none ctv:cursor-pointer ctv:[font-family:inherit] ctv:rounded-sm ' +
    'ctv:px-2 ctv:py-0.5 ctv:text-2xs ctv:border ctv:focus-visible:outline-none ' +
    (active
      ? 'ctv:border-primary-background ctv:text-primary-foreground ctv:bg-primary-background/15'
      : 'ctv:border-border-default ctv:text-muted-foreground ctv:bg-secondary-background')
}

export function miniBtn(active: boolean): string {
  return 'ctv:appearance-none ctv:cursor-pointer ctv:[font-family:inherit] ctv:rounded-sm ' +
    'ctv:px-1.5 ctv:py-0.5 ctv:text-2xs ctv:border ctv:focus-visible:outline-none ' +
    (active
      ? 'ctv:border-primary-background ctv:text-primary-foreground ctv:bg-primary-background/15'
      : 'ctv:border-border-subtle ctv:text-base-foreground ctv:bg-secondary-background')
}

export function rowBtn(active: boolean): string {
  return 'ctv:appearance-none ctv:cursor-pointer ctv:[font-family:inherit] ctv:text-left ' +
    'ctv:rounded-sm ctv:border-none ctv:px-1.5 ctv:py-1 ctv:text-2xs ctv:bg-transparent ' +
    'ctv:hover:bg-secondary-background-hover ' +
    (active ? 'ctv:text-primary-foreground' : 'ctv:text-base-foreground')
}

export function colorKeys(t: T) {
  return [
    { key: 'primary_color', label: t('poster.colorPrimary'), title: t('poster.colorPrimaryTitle') },
    { key: 'accent_color', label: t('poster.colorAccent'), title: t('poster.colorAccentTitle') },
    { key: 'bg_color', label: t('poster.colorBg'), title: t('poster.colorBgTitle') },
  ]
}

export function aligns(t: T) {
  return [
    { v: 'left', l: t('poster.alignLeft') },
    { v: 'center', l: t('poster.alignCenter') },
    { v: 'right', l: t('poster.alignRight') },
    { v: 'justify', l: t('poster.alignJustify') },
  ]
}

export function elColors(t: T) {
  return [
    { v: '', l: t('poster.colorPrimary') },
    { v: 'accent', l: t('poster.colorAccent') },
    { v: 'muted', l: t('poster.colorMuted') },
  ]
}

export function addTypes(t: T) {
  return [
    { type: 'text', label: t('poster.addText') },
    { type: 'image', label: t('poster.addImage') },
    { type: 'shape', label: t('poster.addShape') },
  ]
}

export function alignOps(t: T) {
  return [
    { op: 'left', l: t('poster.alignEdgeLeft') },
    { op: 'hcenter', l: t('poster.alignEdgeHCenter') },
    { op: 'right', l: t('poster.alignEdgeRight') },
    { op: 'top', l: t('poster.alignEdgeTop') },
    { op: 'vcenter', l: t('poster.alignEdgeVCenter') },
    { op: 'bottom', l: t('poster.alignEdgeBottom') },
  ] as const
}

export function distOps(t: T) {
  return [
    { op: 'hspread', l: t('poster.distHSpread') },
    { op: 'vspread', l: t('poster.distVSpread') },
    { op: 'hgap', l: t('poster.distHGap') },
    { op: 'vgap', l: t('poster.distVGap') },
  ] as const
}
