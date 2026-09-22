<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import { Primitive } from 'reka-ui'
import type { HTMLAttributes } from 'vue'

import { cn } from '@comfyorg/tailwind-utils'

import type { ButtonVariants } from './button.variants'
import { buttonVariants } from './button.variants'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
  loading?: boolean
  disabled?: boolean
}

const {
  as = 'button',
  class: customClass = '',
  loading = false,
  disabled = false
} = defineProps<Props>()
</script>

<template>
  <Primitive
    :as
    :as-child
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="cn(buttonVariants({ variant, size }), customClass)"
  >
    <i v-if="loading" class="ctv:icon-[lucide--loader-circle] ctv:animate-spin" aria-hidden="true" />
    <template v-if="loading">
      <span class="ctv:sr-only"><slot /></span>
    </template>
    <slot v-else />
  </Primitive>
</template>
