<template>
  <div class="ctv:flex ctv:flex-col ctv:gap-3">
    <p class="ctv:m-0 ctv:text-xs ctv:leading-relaxed ctv:text-base-foreground ctv:whitespace-pre-wrap">
      {{ $t('pluginUpdate.restartDetail') }}
    </p>
    <div class="ctv:flex ctv:justify-end">
      <button type="button" :class="btnPrimary" @click="close">
        {{ $t('dialog.close') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

const props = defineProps<{
  onResolve: () => void
}>()

let done = false
function close() {
  if (done) return
  done = true
  props.onResolve()
}

onBeforeUnmount(close)

const btnPrimary = 'ctv:appearance-none ctv:border-none ctv:cursor-pointer ctv:[font-family:inherit] ' +
  'ctv:focus-visible:outline-none ctv:h-7 ctv:px-3 ctv:rounded-sm ctv:text-xs ctv:font-medium ' +
  'ctv:bg-primary-background ctv:text-primary-foreground ctv:hover:opacity-90'
</script>
