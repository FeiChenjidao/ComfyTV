<script setup lang="ts">
import { cn } from '@comfyorg/tailwind-utils'

const { accent } = defineProps<{
  /** Leading-edge colour, e.g. `ctv:border-l-success-background`. */
  accent: string
}>()
</script>

<template>
  <div
    :class="
      cn(
        'ctv:pointer-events-auto ctv:relative ctv:flex ctv:items-center ctv:gap-12 ctv:rounded-lg ctv:border ctv:border-l-4 ctv:border-interface-stroke ctv:bg-interface-panel-surface ctv:p-4 ctv:shadow-interface',
        accent
      )
    "
  >
    <div class="ctv:flex ctv:min-w-0 ctv:items-center ctv:gap-2">
      <slot name="icon" />
      <div class="ctv:flex ctv:min-w-0 ctv:flex-col">
        <span class="ctv:text-sm ctv:font-medium ctv:wrap-break-word ctv:text-base-foreground">
          <slot name="title" />
        </span>
        <span
          v-if="$slots.description"
          class="ctv:text-sm ctv:wrap-break-word ctv:text-muted-foreground"
        >
          <slot name="description" />
        </span>
      </div>
    </div>
    <slot name="actions" />
  </div>
</template>
