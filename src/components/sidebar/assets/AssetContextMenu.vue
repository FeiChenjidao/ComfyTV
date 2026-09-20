<template>
  <div
    class="ctv:fixed ctv:inset-0 ctv:z-20"
    @click="emit('close')"
    @contextmenu.prevent="emit('close')"
  >
    <div
      class="ctv:absolute ctv:w-48 ctv:p-1 ctv:rounded-lg ctv:shadow-md
             ctv:bg-interface-menu-surface ctv:border ctv:border-interface-menu-stroke"
      :style="style"
      @click.stop
    >
      <button v-if="asset.media_type === 'image'" :class="menuItemClass" @click="emit('action', 'view-full')">
        <IconMaximize class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('stage.action.viewFull') }}</span>
      </button>
      <button v-if="asset.media_type !== 'model'" :class="menuItemClass" @click="emit('action', 'load-node')">
        <IconDownload class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.card.loadNode') }}</span>
      </button>
      <button v-if="asset.media_type === 'video'" :class="menuItemClass" @click="emit('action', 'make-proxy')">
        <IconClapperboard class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.card.makeProxy') }}</span>
      </button>
      <button v-if="asset.media_type !== 'model'" :class="menuItemClass" @click="emit('action', 'send-eagle')">
        <IconSend class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('eagle.send.action') }}</span>
      </button>
      <button :class="menuItemClass" @click="emit('action', 'edit-tags')">
        <IconTag class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.card.tags') }}</span>
      </button>
      <button :class="menuItemClass" @click="emit('action', 'rename')">
        <IconPencil class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.card.rename') }}</span>
      </button>
      <div class="ctv:my-1 ctv:border-b ctv:border-border-subtle" />
      <button :class="`${menuItemClass} ctv:hover:text-destructive-background`" @click="emit('action', 'delete')">
        <IconTrash2 class="ctv:size-4 ctv:shrink-0" />
        <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.card.delete') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'

import IconClapperboard from '~icons/lucide/clapperboard'
import IconDownload from '~icons/lucide/download'
import IconMaximize from '~icons/lucide/maximize-2'
import IconPencil from '~icons/lucide/pencil'
import IconSend from '~icons/lucide/send'
import IconTag from '~icons/lucide/tag'
import IconTrash2 from '~icons/lucide/trash-2'

import type { Asset } from '@/api/schemas'

export type AssetMenuAction =
  | 'view-full' | 'load-node' | 'make-proxy' | 'send-eagle' | 'edit-tags' | 'rename' | 'delete'

defineProps<{
  asset: Asset
  style: CSSProperties
}>()

const emit = defineEmits<{
  close: []
  action: [name: AssetMenuAction]
}>()

const menuItemClass = [
  'ctv:flex ctv:items-center ctv:gap-2 ctv:w-full ctv:px-2 ctv:py-1.5 ctv:rounded ctv:cursor-pointer ctv:text-left ctv:text-xs',
  'ctv:[font-family:inherit] ctv:bg-transparent ctv:border-none ctv:text-base-foreground',
  'ctv:hover:bg-interface-menu-component-surface-hovered',
].join(' ')
</script>
