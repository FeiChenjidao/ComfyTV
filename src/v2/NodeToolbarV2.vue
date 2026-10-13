<template>
  <template v-for="(item, i) in items" :key="itemKey(item, i)">
    <div v-if="isSep(item)" class="v2-toolbar__sep" />
    <button
      v-else
      type="button"
      :class="btnClass(item)"
      :disabled="!!disabled?.[item.id]"
      :title="titleOf(item)"
      @pointerdown.stop
      @click.stop="onAction(item.id)"
    >
      <span v-if="item.icon" class="v2-toolbar__icon" v-html="item.icon" />
      <span v-if="labelOf(item)">{{ labelOf(item) }}</span>
    </button>
  </template>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import {
  isToolbarAction,
  type NodeToolbarAction,
  type NodeToolbarItem,
} from '@/v2/nodeToolbar'

defineProps<{
  items: NodeToolbarItem[]
  disabled?: Record<string, boolean>
  onAction: (id: string) => void
}>()

function isSep(item: NodeToolbarItem): boolean {
  return !isToolbarAction(item)
}

function itemKey(item: NodeToolbarItem, i: number): string {
  return isToolbarAction(item) ? item.id : `sep-${i}`
}

function labelOf(item: NodeToolbarAction): string {
  return item.labelKey ? t(item.labelKey) : ''
}

function titleOf(item: NodeToolbarAction): string {
  const key = item.titleKey || item.labelKey
  return key ? t(key) : item.id
}

function btnClass(item: NodeToolbarAction): string {
  return labelOf(item)
    ? 'v2-toolbar__btn'
    : 'v2-toolbar__btn v2-toolbar__btn--icononly'
}
</script>

<style scoped>
.v2-toolbar__icon :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.v2-toolbar__btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
