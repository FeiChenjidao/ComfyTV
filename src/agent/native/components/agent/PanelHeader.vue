<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { buildTooltipConfig } from '@agent/composables/useTooltipConfig'

import { cn } from '@comfyorg/tailwind-utils'

import Button from '@agent/components/ui/button/Button.vue'

const { isMaximized = false } = defineProps<{
  isMaximized?: boolean
}>()

const emit = defineEmits<{
  newChat: []
  toggleSize: []
  close: []
}>()

const { t } = useI18n()

const sizeToggleIcon = computed(() =>
  isMaximized ? 'ctv:icon-[lucide--minimize-2]' : 'ctv:icon-[lucide--maximize-2]'
)
const sizeToggleLabel = computed(() =>
  isMaximized ? t('agent.minimize') : t('agent.maximize')
)
</script>

<template>
  <header
    class="ctv:flex ctv:h-12 ctv:shrink-0 ctv:items-center ctv:gap-2 ctv:border-b ctv:border-component-node-border ctv:px-4"
  >
    <h1
      id="agent-panel-title"
      class="ctv:my-0 ctv:text-sm ctv:font-normal ctv:whitespace-nowrap ctv:text-base-foreground"
    >
      {{ t('agent.title') }}
    </h1>

    <div class="ctv:ml-auto ctv:flex ctv:items-center ctv:gap-2">
      <Button
        v-tooltip.bottom="buildTooltipConfig(t('agent.newChat'))"
        variant="muted-textonly"
        size="icon"
        :aria-label="t('agent.newChat')"
        @click="emit('newChat')"
      >
        <span class="ctv:icon-[lucide--message-circle-plus] ctv:size-4" />
      </Button>
      <Button
        v-tooltip.bottom="buildTooltipConfig(sizeToggleLabel)"
        variant="muted-textonly"
        size="icon"
        :aria-label="sizeToggleLabel"
        @click="emit('toggleSize')"
      >
        <span :class="cn(sizeToggleIcon, 'ctv:size-4')" />
      </Button>
      <Button
        v-tooltip.bottom="buildTooltipConfig(t('agent.close'))"
        variant="muted-textonly"
        size="icon"
        :aria-label="t('agent.close')"
        @click="emit('close')"
      >
        <span class="ctv:icon-[lucide--x] ctv:size-4" />
      </Button>
    </div>
  </header>
</template>
