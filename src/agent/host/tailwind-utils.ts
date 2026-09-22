import { clsx } from 'clsx'
import type { ClassArray } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

export type { ClassValue } from 'clsx'

const twMerge = extendTailwindMerge({
  prefix: 'ctv',
  extend: {
    classGroups: {
      'font-size': ['text-xxs', 'text-2xs', 'text-3xs'],
      'max-h': [{ 'max-h': ['none'] }],
    },
  },
})

export function cn(...inputs: ClassArray) {
  return twMerge(clsx(inputs))
}
