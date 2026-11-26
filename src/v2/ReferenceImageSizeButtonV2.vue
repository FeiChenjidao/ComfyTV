<template>
  <div class="v2-refsize" @pointerdown.stop>
    <button type="button" :disabled="loading" title="读取图1的原始宽高，并切换为自定义尺寸" @click.stop="readSize">
      {{ loading ? '正在读取…' : '获取参考图尺寸' }}
      <span>图1</span>
    </button>
    <span v-if="error" class="v2-refsize__error" role="status">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, ref } from 'vue'

import { currentMediaTable } from '@/composables/stages/mediaOrder'
import { mediaEntryUrl } from '@/composables/stages/mediaOrderSync'
import { loadMediaInfo } from '@/composables/stages/useMediaInfo'
import type { LGraphNode } from '@/lib/comfyApp'

const props = defineProps<{ getNode: () => LGraphNode | undefined }>()
const emit = defineEmits<{ size: [width: number, height: number] }>()
const loading = ref(false)
const error = ref('')
let disposed = false
onScopeDispose(() => { disposed = true })

function firstImageUrl(node: LGraphNode): string | null {
  const entry = currentMediaTable(node).image[0]
  return entry ? mediaEntryUrl(node, entry) : null
}

async function readSize() {
  const node = props.getNode()
  const url = node ? firstImageUrl(node) : null
  error.value = ''
  if (!node || !url) {
    error.value = '请先添加参考图1，或等待上游图像就绪。'
    return
  }
  const workflow = node.widgets?.find(widget => widget.name === 'workflow')?.value
  loading.value = true
  try {
    const info = await loadMediaInfo(url)
    if (disposed || props.getNode() !== node) return
    if (firstImageUrl(node) !== url || node.widgets?.find(widget => widget.name === 'workflow')?.value !== workflow) return
    const width = Number(info?.width)
    const height = Number(info?.height)
    if (info?.kind !== 'image' || !(width > 0 && height > 0) || !Number.isFinite(width + height)) {
      error.value = '无法读取图1尺寸，请检查参考图后重试。'
      return
    }
    emit('size', width, height)
  } catch {
    error.value = '无法读取图1尺寸，请检查参考图后重试。'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.v2-refsize { display:grid; gap:5px; margin-top:8px; }
.v2-refsize button { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; height:27px; padding:0 8px; border:1px solid var(--v2-chip-border); border-radius:7px; background:transparent; color:var(--v2-text-mid); font:500 11px/1 system-ui,sans-serif; cursor:pointer; }
.v2-refsize button:hover { background:var(--v2-hover-bg); color:var(--v2-text-strong); }
.v2-refsize button:disabled { opacity:.5; cursor:default; }
.v2-refsize button span { color:var(--v2-text-muted); font-size:10px; }
.v2-refsize__error { color:var(--v2-text-muted); font:500 10px/1.4 system-ui,sans-serif; }
</style>
