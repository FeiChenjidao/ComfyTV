<script setup lang="ts">
import { computed } from 'vue'

import { cn } from '@comfyorg/tailwind-utils'
import Button from '@agent/components/ui/button/Button.vue'
import { iconForMediaType } from '@agent/platform/assets/utils/mediaIconUtil'
import { getMediaTypeFromFilename } from '@agent/utils/formatUtil'

const {
  name,
  previewUrl,
  uploading = false
} = defineProps<{
  name: string
  previewUrl?: string
  uploading?: boolean
}>()
const emit = defineEmits<{ remove: [] }>()

const kind = computed(() => getMediaTypeFromFilename(name))

/* The shared map's 'other' glyph is a checkmark, which reads as a status
   rather than a file on this surface. */
const kindIconClass = computed(() =>
  kind.value === 'other' ? 'ctv:icon-[lucide--file]' : iconForMediaType(kind.value)
)
</script>

<template>
  <!-- `data-attachment-name` anchors black-box coverage of what a drop actually
       attached: the visible label truncates, so asserting on rendered text alone
       cannot tell one long filename from another. -->
  <span
    data-testid="agent-attachment-chip"
    :data-attachment-name="name"
    class="ctv:inline-flex ctv:h-7 ctv:items-center ctv:gap-1 ctv:rounded-lg ctv:border ctv:border-border-default ctv:bg-secondary-background ctv:px-2.5 ctv:text-xs/4 ctv:font-medium ctv:text-base-foreground"
  >
    <span
      v-if="uploading"
      :aria-label="$t('agent.uploading')"
      class="ctv:icon-[lucide--loader-circle] ctv:size-3.5 ctv:animate-spin ctv:text-muted-foreground"
    />
    <!-- Only an image kind renders its preview: a server thumbnail for an
         audio or 3D asset would repaint the broken-image chip this fixed. -->
    <img
      v-else-if="previewUrl && kind === 'image'"
      :src="previewUrl"
      :alt="name"
      class="ctv:size-3.5 ctv:shrink-0 ctv:rounded-sm ctv:object-cover"
    />
    <span v-else :class="cn(kindIconClass, 'ctv:size-3.5 ctv:shrink-0')" />
    <span class="ctv:max-w-32 ctv:truncate">{{ name }}</span>
    <Button
      type="button"
      variant="muted-textonly"
      size="unset"
      :aria-label="$t('agent.remove')"
      class="ctv:size-3.5 ctv:shrink-0"
      @click="emit('remove')"
    >
      <span class="ctv:icon-[lucide--x] ctv:size-3.5 ctv:shrink-0" />
    </Button>
  </span>
</template>
