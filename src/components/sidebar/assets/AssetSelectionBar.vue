<template>
  <div
    class="ctv:shrink-0 ctv:flex ctv:items-center ctv:gap-1.5 ctv:py-1.5 ctv:px-2.5
           ctv:bg-interface-panel-surface ctv:border-b ctv:border-border-subtle"
  >
    <input
      type="checkbox"
      class="ctv:m-0 ctv:shrink-0 ctv:cursor-pointer"
      :checked="allSelected"
      :title="$t('assets.select.all')"
      @change="emit('toggle-all')"
    />
    <span class="ctv:flex-1 ctv:truncate ctv:text-xs ctv:font-semibold">
      {{ $t('assets.select.count', { count }) }}
    </span>
    <button
      :class="btnClass"
      :disabled="!missingCount"
      :title="$t('assets.select.missing', { count: missingCount })"
      @click="emit('select-missing')"
    >
      <IconFileX class="ctv:size-4" />
    </button>
    <button
      :class="btnClass"
      :disabled="!count"
      :title="$t('assets.select.tags')"
      @click="emit('edit-tags', $event)"
    >
      <IconTag class="ctv:size-4" />
    </button>
    <button
      :class="btnClass"
      :disabled="!count"
      :title="$t('assets.select.loadNodes')"
      @click="emit('load-nodes')"
    >
      <IconDownload class="ctv:size-4" />
    </button>
    <button
      :class="`${btnClass} ctv:hover:text-destructive-background`"
      :disabled="!count || busy"
      :title="$t('assets.select.remove')"
      @click="emit('remove')"
    >
      <IconTrash2 class="ctv:size-4" />
    </button>
    <button :class="btnClass" :title="$t('assets.select.exit')" @click="emit('exit')">
      <IconX class="ctv:size-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import IconDownload from '~icons/lucide/download'
import IconFileX from '~icons/lucide/file-x'
import IconTag from '~icons/lucide/tag'
import IconTrash2 from '~icons/lucide/trash-2'
import IconX from '~icons/lucide/x'

defineProps<{
  count: number
  allSelected: boolean
  missingCount: number
  busy?: boolean
}>()

const emit = defineEmits<{
  'toggle-all': []
  'select-missing': []
  'edit-tags': [e: MouseEvent]
  'load-nodes': []
  remove: []
  exit: []
}>()

const btnClass = [
  'ctv:inline-flex ctv:items-center ctv:justify-center ctv:size-7 ctv:shrink-0 ctv:cursor-pointer ctv:appearance-none',
  'ctv:rounded-lg ctv:border ctv:border-border-subtle ctv:bg-secondary-background ctv:text-base-foreground',
  'ctv:hover:bg-secondary-background-hover ctv:transition-colors',
  'ctv:disabled:opacity-40 ctv:disabled:pointer-events-none',
].join(' ')
</script>
