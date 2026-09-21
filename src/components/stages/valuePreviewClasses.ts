const TYPE_BADGE_COLORS: Record<string, string> = {
  COMFYTV_TEXT:       'ctv:bg-[rgb(120_200_120/0.25)] ctv:text-[#b5e3a5]',
  COMFYTV_IMAGE:      'ctv:bg-[rgb(78_168_255/0.25)] ctv:text-[#9dd0ff]',
  COMFYTV_PANORAMA:   'ctv:bg-[rgb(78_168_255/0.25)] ctv:text-[#9dd0ff]',
  COMFYTV_VIDEO:      'ctv:bg-[rgb(255_171_64/0.25)] ctv:text-[#ffd089]',
  COMFYTV_AUDIO:      'ctv:bg-[rgb(255_100_100/0.22)] ctv:text-[#ffb0b0]',
  COMFYTV_STORYBOARD: 'ctv:bg-[rgb(200_130_255/0.25)] ctv:text-[#d8b0ff]',
  COMFYTV_IMAGES:     'ctv:bg-[rgb(255_140_200/0.25)] ctv:text-[#ffb0d8]',
  COMFYTV_AUDIOS:     'ctv:bg-[rgb(255_100_100/0.22)] ctv:text-[#ffb0b0]',
  COMFYTV_VIDEOS:     'ctv:bg-[rgb(255_171_64/0.25)] ctv:text-[#ffd089]',
  COMFYTV_MODEL:      'ctv:bg-[rgb(100_220_200/0.25)] ctv:text-[#a5f0e0]',
  COMFYTV_MATERIAL:   'ctv:bg-[rgb(210_180_100/0.25)] ctv:text-[#ecd9a0]',
  COMFYTV_FXSPEC:     'ctv:bg-[rgb(120_140_255/0.25)] ctv:text-[#b8c4ff]',
}

export function typeBadgeClass(type: string): string {
  const palette = TYPE_BADGE_COLORS[type] ?? 'ctv:bg-white/10 ctv:text-white/70'
  return `ctv:absolute ctv:top-[3px] ctv:right-[3px] ctv:py-px ctv:px-[5px] ctv:text-3xs ctv:tracking-wide ctv:rounded-sm ctv:pointer-events-none ${palette}`
}

export function rootClass(compact: boolean): string {
  if (compact) return 'ctv:relative ctv:size-full ctv:overflow-hidden'
  return 'ctv:relative ctv:flex ctv:flex-col ctv:min-h-12 ctv:text-xs ctv:overflow-hidden'
}

export function emptyClass(compact: boolean): string {
  return compact
    ? 'ctv:flex ctv:items-center ctv:justify-center ctv:h-full ctv:p-1 ctv:text-3xs ctv:italic ctv:opacity-50'
    : 'ctv:flex ctv:items-center ctv:justify-center ctv:h-full ctv:min-h-10 ctv:text-[11px] ctv:italic ctv:opacity-50'
}

export const textClass =
  'ctv:m-0 ctv:p-1 ctv:max-h-full ctv:text-2xs ctv:leading-[1.3] ctv:overflow-hidden ctv:whitespace-pre-wrap ctv:font-mono ctv:break-words ctv:text-base-foreground'
  + ' ctv:[display:-webkit-box] ctv:[-webkit-line-clamp:5] ctv:[-webkit-box-orient:vertical]'

export function imgClass(compact: boolean): string {
  return compact
    ? 'ctv:block ctv:size-full ctv:object-cover'
    : 'ctv:block ctv:w-full ctv:max-h-40 ctv:object-contain ctv:rounded-sm'
}

export function videoClass(compact: boolean, hasAlpha: boolean): string {
  const bg = hasAlpha ? 'ctv-checker' : 'ctv:bg-black'
  return compact
    ? `ctv:block ctv:size-full ctv:object-cover ${bg}`
    : `ctv:block ctv:w-full ctv:max-h-52 ctv:rounded-sm ${bg}`
}

export const compactSummary = 'ctv:flex ctv:flex-col ctv:items-center ctv:justify-center ctv:size-full ctv:gap-0.5'

export const storyboardListClass = 'ctv:flex ctv:flex-col ctv:gap-1 ctv:pt-3.5 ctv:max-h-56 ctv:overflow-auto'
export const shotRowClass = 'ctv:flex ctv:items-baseline ctv:gap-1.5 ctv:py-[3px] ctv:px-[5px] ctv:text-[11px] ctv:rounded-sm'
  + ' ctv:bg-base-foreground/[0.03] ctv:border-l-2 ctv:border-[rgb(200_130_255/0.4)]'
export const shotNoClass     = 'ctv:shrink-0 ctv:font-bold ctv:text-[#d8b0ff]'
export const shotDurClass    = 'ctv:shrink-0 ctv:py-px ctv:px-1 ctv:text-2xs ctv:rounded-sm ctv:bg-base-foreground/5 ctv:text-muted-foreground'
export const shotPromptClass = 'ctv:flex-auto ctv:break-words ctv:text-base-foreground'

const COMFY_BTN_BASE = 'ctv:relative ctv:inline-flex ctv:items-center ctv:justify-center ctv:gap-2 ctv:cursor-pointer'
  + ' ctv:touch-manipulation ctv:whitespace-nowrap ctv:appearance-none ctv:border-none ctv:transition-colors'
  + ' ctv:disabled:pointer-events-none ctv:disabled:opacity-50'

export const imgActionsClass = 'vp-img-actions ctv:absolute ctv:top-1 ctv:right-1 ctv:z-10 ctv:flex ctv:gap-1'

export const imgActionBtn = COMFY_BTN_BASE
  + ' ctv:size-5 ctv:p-0 ctv:rounded-sm ctv:text-sm'
  + ' ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90'

export function batchCellClass(selected: boolean, pick: boolean): string {
  const base = 'vp-img-host ctv:group ctv:relative ctv:aspect-video ctv:rounded-sm ctv:overflow-hidden ctv:p-0 ctv:bg-black ctv:border ctv:transition-colors'
  const interactive = pick ? ' ctv:cursor-pointer' : ' ctv:cursor-default'
  if (selected) {
    return base + interactive + ' ctv:border-primary-background ctv:ring-[5px] ctv:ring-inset ctv:ring-primary-background'
  }
  return base + interactive
    + ' ctv:border-border-default'
    + (pick ? ' ctv:hover:border-primary-background' : '')
}

export function audioRowClass(selected: boolean, pick: boolean): string {
  const base = 'vp-img-host ctv:group ctv:relative ctv:flex ctv:flex-col ctv:gap-1.5 ctv:p-1.5 ctv:rounded-sm ctv:border ctv:transition-colors'
  if (selected) {
    return base + ' ctv:border-primary-background ctv:bg-primary-background/10'
  }
  return base + ' ctv:border-border-default ctv:bg-base-foreground/[0.03]'
    + (pick ? ' ctv:hover:border-primary-background' : '')
}
