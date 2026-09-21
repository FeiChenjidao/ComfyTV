<template>
  <Teleport to="body">
    <div
      v-if="tagging.tagMenu.value"
      class="ctv:fixed ctv:inset-0 ctv:z-[9999]"
      @click="tagging.closeTagMenu()"
      @wheel.prevent.stop
    >
      <div
        class="ctv:absolute ctv:w-44 ctv:max-h-64 ctv:overflow-y-auto ctv:p-1 ctv:rounded ctv:shadow-md ctv:text-xs
               ctv:bg-interface-menu-surface ctv:border ctv:border-border-default"
        :style="tagging.tagMenuStyle.value"
        @click.stop
      >
        <button type="button" :class="rowClass" @click.stop="tagging.setUncategorized()">
          <span class="ctv:w-3 ctv:inline-block ctv:text-primary-background"><i v-if="tagging.tagMenuIsUncategorized()" class="pi pi-check" /></span>
          <span class="ctv:flex-1 ctv:truncate ctv:italic ctv:text-muted-foreground">{{ $t('assets.category.none') }}</span>
        </button>
        <div class="ctv:my-1 ctv:border-t ctv:border-border-subtle"></div>
        <button
          v-for="cat in tagging.categories.value"
          :key="cat.id"
          type="button"
          :class="rowClass"
          @click.stop="tagging.toggleOutputTag(cat.id)"
        >
          <span class="ctv:w-3 ctv:inline-block ctv:text-primary-background"><i v-if="tagging.tagMenuHas(cat.id)" class="pi pi-check" /></span>
          <span class="ctv:flex-1 ctv:truncate">{{ cat.name }}</span>
        </button>
        <div v-if="tagging.categories.value.length" class="ctv:my-1 ctv:border-t ctv:border-border-subtle"></div>
        <button type="button" :class="createClass" @click.stop="onCreateCategory">
          <span class="ctv:w-3 ctv:inline-block"><i class="pi pi-plus" /></span>
          <span class="ctv:flex-1 ctv:truncate">{{ $t('assets.tagPopover.create') }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { askText } from '@/composables/dialog/useTextInputDialog'
import type { useOutputAssetTagging } from '@/composables/stages/useOutputAssetTagging'

const props = defineProps<{
  tagging: ReturnType<typeof useOutputAssetTagging>
}>()

const { t } = useI18n()

const rowBase = 'ctv:flex ctv:items-center ctv:gap-1.5 ctv:w-full ctv:px-1.5 ctv:py-1 ctv:rounded-sm ctv:cursor-pointer'
  + ' ctv:text-left ctv:text-2xs ctv:bg-transparent ctv:border-none ctv:hover:bg-secondary-background-hover'
const rowClass = rowBase + ' ctv:text-base-foreground'
const createClass = rowBase + ' ctv:text-primary-background'

async function onCreateCategory() {
  const name = (await askText({
    title: t('assets.category.new'),
    label: t('assets.category.newPrompt'),
  }))?.trim()
  if (!name) return
  await props.tagging.createCategoryAndTag(name)
}
</script>
