<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core'
import type { SliderRootEmits, SliderRootProps } from 'reka-ui'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack, useForwardPropsEmits } from 'reka-ui'
import { ref } from 'vue'
import type { HTMLAttributes } from 'vue'

import { cn } from '@comfyorg/tailwind-utils'

const props = defineProps<
  SliderRootProps & {
    class?: HTMLAttributes['class']
    rangeClass?: HTMLAttributes['class']
    thumbClass?: HTMLAttributes['class']
  }
>()

const pressed = ref(false)
const setPressed = (val: boolean) => {
  pressed.value = val
}

const emits = defineEmits<SliderRootEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'rangeClass', 'thumbClass')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SliderRoot
    v-slot="{ modelValue }"
    data-slot="slider"
    :class="
      cn(
        'ctv:relative ctv:flex ctv:w-full ctv:touch-none ctv:items-center ctv:select-none ctv:data-disabled:opacity-50',
        'ctv:data-[orientation=vertical]:h-full ctv:data-[orientation=vertical]:min-h-44 ctv:data-[orientation=vertical]:w-auto ctv:data-[orientation=vertical]:flex-col',
        props.class
      )
    "
    v-bind="forwarded"
    @slide-start="() => setPressed(true)"
    @slide-move="() => setPressed(true)"
    @slide-end="() => setPressed(false)"
  >
    <SliderTrack
      data-slot="slider-track"
      :class="
        cn(
          'ctv:relative ctv:grow ctv:overflow-hidden ctv:rounded-full ctv:bg-node-stroke',
          'ctv:cursor-pointer ctv:overflow-visible',
          'ctv:before:absolute ctv:before:-inset-2 ctv:before:block ctv:before:bg-transparent',
          'ctv:data-[orientation=horizontal]:h-0.5 ctv:data-[orientation=horizontal]:w-full',
          'ctv:data-[orientation=vertical]:h-full ctv:data-[orientation=vertical]:w-0.5'
        )
      "
    >
      <SliderRange
        data-slot="slider-range"
        :class="
          cn(
            'ctv:absolute ctv:bg-node-component-surface-highlight ctv:data-[orientation=horizontal]:h-full ctv:data-[orientation=vertical]:w-full',
            props.rangeClass
          )
        "
      />
    </SliderTrack>

    <SliderThumb
      v-for="(_, key) in modelValue"
      :key="key"
      data-slot="slider-thumb"
      :class="
        cn(
          'ctv:block ctv:size-3.5 ctv:shrink-0 ctv:rounded-full ctv:bg-node-component-surface-highlight ctv:shadow-sm ctv:ring-node-component-surface-selected ctv:transition-[color,box-shadow]',
          'ctv:cursor-grab',
          'ctv:before:absolute ctv:before:-inset-1 ctv:before:block ctv:before:rounded-full ctv:before:bg-transparent',
          'ctv:hover:ring-2 ctv:focus-visible:ring-2 ctv:focus-visible:outline-hidden ctv:disabled:pointer-events-none ctv:disabled:opacity-50',
          { 'ctv:cursor-grabbing': pressed },
          props.thumbClass
        )
      "
    />
  </SliderRoot>
</template>
