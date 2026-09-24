<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'
import Button from '@agent/components/ui/button/Button.vue'

const { userName } = defineProps<{ userName?: string }>()
const emit = defineEmits<{ insert: [text: string] }>()

const { t, tm } = useI18n()

const prompts = computed(() => tm('agent.suggestedPrompts') as string[])

const promptIcons = [
  'ctv:icon-[lucide--lightbulb]',
  'ctv:icon-[lucide--list]',
  'ctv:icon-[lucide--search]',
  'ctv:icon-[lucide--message-circle-warning]',
  'ctv:icon-[lucide--workflow]'
]
</script>

<template>
  <div class="ctv:flex ctv:h-full ctv:flex-col ctv:overflow-x-hidden ctv:overflow-y-auto ctv:px-4 ctv:py-8">
    <div class="ctv:my-auto ctv:flex ctv:shrink-0 ctv:flex-col ctv:items-center ctv:gap-8 ctv:text-center">
      <div class="ctv:flex ctv:flex-col ctv:items-center ctv:gap-4 ctv:pt-12">
        <div
          class="ctv:flex ctv:size-12 ctv:items-center ctv:justify-center ctv:rounded-xl ctv:border ctv:border-plum-600 ctv:bg-ink-700"
        >
          <span
            class="ctv:icon-[lucide--bot] ctv:size-6 ctv:text-brand-yellow drop-shadow-[0_0_12px_currentColor]"
            aria-hidden="true"
          />
        </div>
        <div
          class="ctv:flex ctv:max-w-sm ctv:flex-col ctv:items-center ctv:text-base/snug ctv:font-semibold ctv:tracking-tight ctv:text-base-foreground @min-[570px]:text-2xl/snug"
        >
          <p class="ctv:my-0">
            {{ t('agent.greeting', { name: userName ?? t('agent.friend') }) }}
          </p>
          <p class="ctv:my-0">
            {{ t('agent.greetingQuestion') }}
          </p>
        </div>
      </div>
      <div
        data-testid="suggested-prompts"
        class="ctv:mx-auto ctv:flex ctv:w-full ctv:max-w-[608px] ctv:shrink-0 ctv:flex-wrap ctv:gap-2 @min-[460px]:justify-center"
      >
        <Button
          v-for="(prompt, index) in prompts"
          :key="index"
          type="button"
          variant="secondary"
          size="md"
          class="ctv:w-full ctv:max-w-full ctv:min-w-0 ctv:justify-start ctv:rounded-full ctv:px-3 ctv:text-sm @min-[460px]:w-auto"
          @click="emit('insert', prompt)"
        >
          <span
            :class="
              cn(
                'ctv:size-3 ctv:shrink-0 ctv:text-muted-foreground',
                promptIcons[index] ?? 'ctv:icon-[lucide--sparkles]'
              )
            "
            aria-hidden="true"
          />
          <span class="ctv:truncate">{{ prompt }}</span>
        </Button>
      </div>
    </div>
  </div>
</template>
