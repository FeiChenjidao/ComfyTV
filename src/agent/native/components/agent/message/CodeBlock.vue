<script setup lang="ts">
import { useClipboard, watchDebounced } from '@vueuse/core'
import { default as DOMPurify } from 'dompurify'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { cn } from '@comfyorg/tailwind-utils'

import SanitizedHtml from '@agent/components/common/SanitizedHtml.vue'
import Button from '@agent/components/ui/button/Button.vue'

const { code, lang = 'text' } = defineProps<{
  code: string
  lang?: string
}>()

const { t } = useI18n()
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })

// shiki highlights asynchronously and its bundle is lazy-loaded, so the block first
// renders as plain escaped code and swaps to the highlighted markup once shiki resolves.
// An unknown language (or a shiki failure) degrades to the plain fallback rather than
// throwing. shiki emits its own trusted <span> markup, safe to inject.
const highlighted = ref<string | null>(null)

// watchDebounced (not watchEffect) so the code/lang deps are tracked even though the highlight
// body awaits the lazy shiki import, and streaming token bursts collapse into one re-highlight.
// The previous highlight stays visible until the next one resolves, so the block never flashes
// back to plain mid-stream.
watchDebounced(
  () => [code, lang] as const,
  async ([currentCode, currentLang], _prev, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    try {
      const { codeToHtml } = await import('shiki')
      const html = await codeToHtml(currentCode, {
        lang: currentLang,
        theme: 'github-dark',
        colorReplacements: { '#24292e': 'transparent' }
      })
      if (!cancelled) highlighted.value = DOMPurify.sanitize(html)
    } catch {
      if (!cancelled) highlighted.value = null
    }
  },
  { immediate: true, debounce: 100 }
)
</script>

<template>
  <div
    class="ctv:group ctv:relative ctv:my-2 ctv:overflow-hidden ctv:rounded-md ctv:border ctv:border-border-default"
  >
    <div
      class="ctv:flex ctv:items-center ctv:justify-between ctv:border-b ctv:border-border-default ctv:bg-secondary-background-hover ctv:px-3 ctv:py-1.5"
    >
      <span
        class="ctv:flex ctv:items-center ctv:gap-1.5 ctv:font-mono ctv:text-xs ctv:text-muted-foreground"
      >
        <span class="ctv:icon-[lucide--file-code] ctv:size-3.5" />
        <span class="ctv:font-medium ctv:text-base-foreground">{{ lang }}</span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="ctv:gap-1 ctv:font-mono"
        @click="copy(code)"
      >
        <span
          :class="
            cn(
              'ctv:size-3.5',
              copied ? 'ctv:icon-[lucide--check]' : 'ctv:icon-[lucide--copy]'
            )
          "
        />
        {{ copied ? t('agent.copied') : t('agent.copy') }}
      </Button>
    </div>
    <SanitizedHtml
      v-if="highlighted"
      class="ctv:overflow-x-auto ctv:p-4 ctv:font-mono ctv:text-sm ctv:[&_pre]:bg-transparent"
      :html="highlighted"
    />
    <pre
      v-else
      class="ctv:overflow-x-auto ctv:p-4 ctv:font-mono ctv:text-sm ctv:text-base-foreground"
    ><code>{{ code }}</code></pre>
  </div>
</template>
