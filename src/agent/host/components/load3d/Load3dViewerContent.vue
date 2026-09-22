<script setup lang="ts">
defineProps<{ modelUrl: string }>()
</script>

<template>
  <div class="ctv:flex ctv:size-full ctv:items-center ctv:justify-center ctv:p-4 ctv:text-sm ctv:text-muted-foreground">
    <a :href="modelUrl" target="_blank" rel="noopener" class="ctv:underline">{{ modelUrl }}</a>
  </div>
</template>
