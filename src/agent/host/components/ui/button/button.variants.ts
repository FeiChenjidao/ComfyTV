import type { VariantProps } from 'cva'
import { cva } from 'cva'

export const buttonVariants = cva({
  base: 'ctv:relative ctv:inline-flex ctv:items-center ctv:justify-center ctv:gap-2 ctv:cursor-pointer ctv:touch-manipulation ctv:whitespace-nowrap ctv:appearance-none ctv:border-none ctv:rounded-md ctv:text-sm ctv:font-medium ctv:font-inter ctv:transition-colors ctv:focus-visible:outline-none ctv:focus-visible:ring-1 ctv:focus-visible:ring-ring ctv:disabled:pointer-events-none ctv:disabled:opacity-50 ctv:[&_svg]:pointer-events-none ctv:[&_svg:not([width]):not([height])]:size-4 ctv:[&_svg]:shrink-0',
  variants: {
    variant: {
      secondary:
        'ctv:text-secondary-foreground ctv:bg-secondary-background ctv:hover:bg-secondary-background-hover',
      primary:
        'ctv:bg-primary-background ctv:text-base-foreground ctv:hover:bg-primary-background-hover',
      inverted:
        'ctv:bg-base-foreground ctv:text-base-background ctv:hover:bg-base-foreground/80',
      destructive:
        'ctv:bg-destructive-background ctv:text-base-foreground ctv:hover:bg-destructive-background-hover',
      textonly:
        'ctv:bg-transparent ctv:text-base-foreground ctv:hover:bg-secondary-background-hover',
      'muted-textonly':
        'ctv:bg-transparent ctv:text-muted-foreground ctv:hover:bg-secondary-background-hover',
      'destructive-textonly':
        'ctv:bg-transparent ctv:text-destructive-background ctv:hover:bg-destructive-background/10',
      outline:
        'ctv:border ctv:border-solid ctv:border-border-default ctv:bg-transparent ctv:text-base-foreground ctv:hover:bg-secondary-background-hover',
      link: 'ctv:bg-transparent ctv:text-muted-foreground ctv:hover:text-base-foreground',
      'overlay-white': 'ctv:bg-white ctv:text-gray-600 ctv:hover:bg-white/90',
      base: 'ctv:bg-base-background ctv:text-base-foreground ctv:hover:bg-secondary-background-hover',
      tertiary:
        'ctv:bg-tertiary-background ctv:text-base-foreground ctv:hover:bg-tertiary-background-hover',
      subscribe:
        'ctv:border-transparent ctv:bg-credit ctv:text-charcoal-800 ctv:hover:opacity-80',
      'brand-ghost':
        'ctv:bg-transparency-white-t8 ctv:text-primary-warm-white ctv:hover:bg-transparency-white-t20 ctv:focus-visible:ring-2 ctv:focus-visible:ring-brand-yellow',
      'brand-solid':
        'ctv:bg-brand-yellow ctv:text-primary-comfy-ink ctv:hover:bg-brand-yellow/90 ctv:focus-visible:ring-2 ctv:focus-visible:ring-primary-warm-white',
      'brand-ghost-accent':
        'ctv:bg-transparency-white-t8 ctv:text-primary-warm-white ctv:hover:bg-brand-yellow ctv:hover:text-primary-comfy-ink ctv:focus-visible:ring-2 ctv:focus-visible:ring-brand-yellow'
    },
    size: {
      sm: 'ctv:h-6 ctv:rounded-sm ctv:px-2 ctv:py-1 ctv:text-xs',
      md: 'ctv:h-8 ctv:rounded-lg ctv:p-2 ctv:text-xs',
      lg: 'ctv:h-10 ctv:rounded-lg ctv:px-4 ctv:py-2 ctv:text-sm',
      'icon-sm': 'ctv:size-5 ctv:p-0',
      icon: 'ctv:size-8',
      'icon-lg': 'ctv:size-10',
      brand:
        'ctv:h-12 ctv:rounded-2xl ctv:px-5 ctv:font-formula ctv:text-sm ctv:font-semibold ctv:tracking-[0.7px] ctv:uppercase ctv:lg:h-13 ctv:xl:h-14 ctv:2xl:h-16',
      'brand-icon': 'ctv:size-10 ctv:rounded-2xl ctv:xl:size-12',
      unset: ''
    }
  },

  defaultVariants: {
    variant: 'secondary',
    size: 'md'
  }
})

export type ButtonVariants = VariantProps<typeof buttonVariants>

const variants = [
  'secondary',
  'primary',
  'inverted',
  'destructive',
  'textonly',
  'muted-textonly',
  'destructive-textonly',
  'outline',
  'link',
  'base',
  'tertiary',
  'overlay-white',
  'subscribe',
  'brand-ghost',
  'brand-solid',
  'brand-ghost-accent'
] as const satisfies Array<ButtonVariants['variant']>
const sizes = [
  'sm',
  'md',
  'lg',
  'icon-sm',
  'icon',
  'icon-lg',
  'brand',
  'brand-icon'
] as const satisfies Array<ButtonVariants['size']>

export const FOR_STORIES = { variants, sizes } as const
