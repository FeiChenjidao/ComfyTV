<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import IconX from '~icons/lucide/x'

import AssetsPanel from '@/components/sidebar/AssetsPanel.vue'

import { ASSETS_POPUP_HIDE } from './assetsPopupBridge'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

function onHideRequest() {
  emit('close')
}

onMounted(() => window.addEventListener(ASSETS_POPUP_HIDE, onHideRequest))
onBeforeUnmount(() => window.removeEventListener(ASSETS_POPUP_HIDE, onHideRequest))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="ctv-assets-pop comfytv-root"
      data-comfytv-assets-popup
      role="dialog"
      aria-modal="false"
      :aria-label="$t('v2.bottomBar.assets')"
    >
      <button
        type="button"
        class="ctv-assets-pop__close"
        :aria-label="$t('dialog.close')"
        :title="$t('dialog.close')"
        @click="emit('close')"
      >
        <IconX class="ctv:size-4" />
      </button>
      <div class="ctv-assets-pop__body">
        <AssetsPanel :active="open" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctv-assets-pop {
  --ctv-assets-inset: 100px;
  position: fixed;
  inset: var(--ctv-assets-inset);
  z-index: 1190;
  width: auto;
  height: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--color-interface-stroke, #3a3a3a) 80%, transparent);
  background: color-mix(in srgb, var(--color-agent-surface, #1c1c1c) 96%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  color: var(--color-base-foreground, #f0f0f0);
  font-family: inherit;
}

.ctv-assets-pop__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 8%, transparent);
  color: inherit;
  cursor: pointer;
  opacity: 0.75;
}

.ctv-assets-pop__close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-base-foreground, #fff) 14%, transparent);
}

.ctv-assets-pop__body {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ctv-assets-pop__body > :deep(*) {
  flex: 1 1 auto;
  min-height: 0;
}

.ctv-assets-pop__body :deep(> div > div:first-child) {
  padding-right: 40px;
}

@media (max-width: 900px) {
  .ctv-assets-pop {
    --ctv-assets-inset: max(24px, min(100px, 8vw));
  }
}
</style>
