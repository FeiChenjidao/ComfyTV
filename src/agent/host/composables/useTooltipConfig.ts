const AGENT_TOOLTIP_SHOW_DELAY = 300

export const AGENT_REKA_TOOLTIP_PROVIDER_PROPS = {
  delayDuration: AGENT_TOOLTIP_SHOW_DELAY,
  skipDelayDuration: 0,
  disableHoverableContent: true,
} as const

const AGENT_TOOLTIP_SURFACE_CLASS =
  'ctv:rounded-lg ctv:bg-[#171717] ctv:px-3 ctv:py-1.5 ctv:font-inter ctv:text-xs ctv:leading-4 ctv:text-[#fafafa] ctv:shadow-none ctv:ring-1 ctv:ring-inset ctv:ring-charcoal-200'

export const AGENT_REKA_TOOLTIP_CONTENT_CLASS =
  `ctv:z-1700 ctv:w-max ctv:whitespace-nowrap ctv:will-change-opacity ${AGENT_TOOLTIP_SURFACE_CLASS} ` +
  'ctv:data-[state=delayed-open]:animate-in ctv:data-[state=delayed-open]:fade-in-0 ctv:data-[state=delayed-open]:duration-[250ms] ctv:data-[state=delayed-open]:ease-linear ' +
  'ctv:data-[state=instant-open]:animate-in ctv:data-[state=instant-open]:fade-in-0 ctv:data-[state=instant-open]:duration-[250ms] ctv:data-[state=instant-open]:ease-linear'

export const buildTooltipConfig = (value: string) => ({
  value,
  showDelay: AGENT_TOOLTIP_SHOW_DELAY,
  hideDelay: 0,
  pt: {
    text: { class: AGENT_TOOLTIP_SURFACE_CLASS },
    arrow: { class: 'ctv:hidden' },
  },
})

export const buildAgentTooltipConfig = (value: string) => ({
  value,
  showDelay: AGENT_TOOLTIP_SHOW_DELAY,
  hideDelay: 0,
  pt: {
    text: { class: AGENT_TOOLTIP_SURFACE_CLASS },
    arrow: { class: 'ctv:hidden' },
  },
})
