<script setup lang="ts">
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from 'reka-ui'
import { computed, ref } from 'vue'

import { useModalLiftedZIndex } from '@agent/composables/useModalLiftedZIndex'
import { cn } from '@comfyorg/tailwind-utils'

const {
  label,
  testId,
  triggerClass,
  contentClass: contentClassOverride,
  ringClass = 'ctv:focus-visible:ring-base-foreground',
  side = 'top',
  sideOffset = 6,
  delayDuration = 300,
  disabled = false,
  skipDelayDuration = 300,
  disableHoverableContent = false,
  disableClosingTrigger = true,
  align = 'center',
  collisionPadding = 0
} = defineProps<{
  label: string | string[]
  testId?: string
  triggerClass?: string
  contentClass?: string
  ringClass?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  delayDuration?: number
  disabled?: boolean
  skipDelayDuration?: number
  disableHoverableContent?: boolean
  disableClosingTrigger?: boolean
  align?: 'start' | 'center' | 'end'
  collisionPadding?: number
}>()

const open = ref(false)
const contentStyle = useModalLiftedZIndex(open)

const labelText = computed(() =>
  Array.isArray(label) ? label.join(', ') : label
)

const contentClass = computed(() =>
  cn(
    'ctv:z-1700 ctv:max-w-48 ctv:rounded-md ctv:bg-charcoal-300 ctv:px-3 ctv:py-2',
    'ctv:text-xs ctv:text-white ctv:shadow-interface ctv:will-change-[transform,opacity]',
    'ctv:data-[state=closed]:animate-out ctv:data-[state=open]:animate-in',
    'ctv:data-[state=closed]:fade-out-0 ctv:data-[state=open]:fade-in-0',
    'ctv:data-[state=closed]:zoom-out-95 ctv:data-[state=open]:zoom-in-95',
    contentClassOverride
  )
)
</script>

<template>
  <TooltipProvider
    :delay-duration
    :skip-delay-duration
    :disable-hoverable-content
  >
    <TooltipRoot v-model:open="open" :disabled :disable-closing-trigger>
      <TooltipTrigger as-child>
        <slot name="trigger">
          <button
            type="button"
            :aria-label="labelText"
            :data-testid="testId"
            :class="
              cn(
                'ctv:cursor-pointer ctv:border-none ctv:bg-transparent ctv:p-0 ctv:focus-visible:ring-1 ctv:focus-visible:outline-none',
                ringClass,
                triggerClass
              )
            "
            @click.stop="open = true"
          >
            <slot />
          </button>
        </slot>
      </TooltipTrigger>
      <TooltipPortal>
        <!-- aria-label=" " stops reka duplicating the label as a description -->
        <TooltipContent
          :side
          :side-offset
          :align
          :collision-padding
          :aria-hidden="$slots.trigger ? undefined : true"
          :aria-label="$slots.trigger ? undefined : ' '"
          data-testid="disclosure-tooltip"
          :style="contentStyle"
          :class="contentClass"
        >
          <slot name="content">{{ labelText }}</slot>
          <TooltipArrow :width="10" :height="5" class="ctv:fill-charcoal-300" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
