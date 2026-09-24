<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'

import { useAgentPanelStore } from '../native/stores/agent/agentPanelStore'

const store = useAgentPanelStore()
const { isVisible } = storeToRefs(store)
const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    data-testid="comfytv-agent-entry"
    :aria-pressed="isVisible"
    :class="
      cn(
        'agent-scope ctv:relative ctv:inline-flex ctv:h-6 ctv:shrink-0 ctv:cursor-pointer ctv:items-center ctv:justify-center ctv:gap-2 ctv:rounded-sm ctv:border ctv:border-solid ctv:px-2 ctv:py-1 ctv:font-inter ctv:text-xs ctv:font-medium ctv:whitespace-nowrap ctv:transition-colors ctv:text-base-foreground',
        isVisible
          ? 'ctv:border-plum-600 ctv:bg-plum-600/20'
          : 'ctv:border-border-default ctv:bg-transparent ctv:hover:bg-secondary-background-hover',
      )
    "
    @click="store.toggle()"
  >
    <i class="ctv:icon-[lucide--bot] ctv:size-3.5 ctv:text-brand-yellow" />
    <span>{{ t('agentBar.entry') }}</span>
  </button>
</template>
