<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useTemplateRef } from 'vue'

import { cn } from '@comfyorg/tailwind-utils'

const { class: className } = defineProps<{
  class?: HTMLAttributes['class']
}>()

const modelValue = defineModel<string | number>()

const inputRef = useTemplateRef<HTMLInputElement>('inputEl')

defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select(),
  blur: () => inputRef.value?.blur(),
  setSelectionRange: (start: number, end: number) =>
    inputRef.value?.setSelectionRange(start, end),
  selectAll: () =>
    inputRef.value?.setSelectionRange(0, inputRef.value.value.length)
})
</script>

<template>
  <input
    ref="inputEl"
    v-model="modelValue"
    :class="
      cn(
        'ctv:flex ctv:h-10 ctv:w-full ctv:min-w-0 ctv:appearance-none ctv:rounded-lg ctv:border-none ctv:bg-secondary-background ctv:px-4 ctv:py-2 ctv:text-sm ctv:text-base-foreground ctv:placeholder:text-muted-foreground ctv:focus-visible:ring-1 ctv:focus-visible:ring-border-default ctv:focus-visible:outline-none ctv:disabled:pointer-events-none ctv:disabled:opacity-50',
        className
      )
    "
  />
</template>
