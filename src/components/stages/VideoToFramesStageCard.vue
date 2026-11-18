<template>
  <FxCardShell :node="node">
    <template #player>
      <VideoPlayerLite :source-video-url="sourceVideoUrl" />
    </template>

    <div
      class="ctv:flex ctv:flex-col ctv:gap-1.5"
      @pointerdown.stop
      @pointermove.stop
      @pointerup.stop
    >
      <FxChips v-model="mode" :options="modeOptions" />

      <div v-if="mode === 'every_n'" class="ctv-field-row">
        <span>{{ $t('videoToFrames.everyN') }}</span>
        <input v-model.number="everyN" type="number" min="1" max="1000" step="1" />
      </div>
      <div v-else-if="mode === 'target_fps'" class="ctv-field-row">
        <span>{{ $t('videoToFrames.targetFps') }}</span>
        <input v-model.number="targetFps" type="number" min="0.1" max="240" step="0.1" />
      </div>

      <div class="ctv:grid ctv:grid-cols-2 ctv:gap-1">
        <label class="ctv-field-box">
          <span>{{ $t('videoToFrames.start') }}</span>
          <input v-model.number="startS" type="number" min="0" step="0.01" />
        </label>
        <label class="ctv-field-box">
          <span>{{ $t('videoToFrames.end') }}</span>
          <input v-model.number="endS" type="number" min="0" step="0.01" />
        </label>
      </div>

      <div class="ctv-field-row">
        <span>{{ $t('videoToFrames.maxFrames') }}</span>
        <input v-model.number="maxFrames" type="number" min="0" max="100000" step="1" />
      </div>

      <FxChips v-model="imageFormat" :options="formatOptions" />
      <div v-if="imageFormat === 'jpeg'" class="ctv-field-row">
        <span>{{ $t('videoToFrames.jpegQuality') }}</span>
        <input v-model.number="jpegQuality" type="number" min="1" max="100" step="1" />
      </div>
    </div>

    <div class="ctv:text-2xs ctv:text-center ctv:py-0.5 ctv:tracking-wide">
      <span v-if="!sourceVideoUrl" class="ctv:text-muted-foreground">{{ $t('videoTrim.noInputVideo') }}</span>
      <span v-else-if="state.running" class="ctv:text-muted-foreground">{{ $t('videoToFrames.processing') }}</span>
      <span v-else-if="state.output" class="ctv:text-success-background">{{ $t('videoToFrames.done') }}</span>
      <span v-else class="ctv:text-muted-foreground">{{ $t('videoToFrames.ready') }}</span>
    </div>

    <StageCard
      :state="state"
      :node="node"
      :on-run-request="onRunRequest"
      :on-cancel-request="onCancelRequest"
      :on-disconnect="onDisconnect"
      :on-action="onAction"
    />
  </FxCardShell>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LGraphNode } from '@/lib/comfyApp'
import type { StageState } from '@/stores/stageStore'
import StageCard from '@/components/stages/StageCard.vue'
import FxCardShell from '@/components/stages/FxCardShell.vue'
import VideoPlayerLite from '@/components/widgets/VideoPlayerLite.vue'
import FxChips from '@/components/widgets/fx/FxChips.vue'
import { pickSourceImageUrl } from '@/composables/stages/stageInputs'
import { useNumWidget, useStrWidget } from '@/composables/widgets/useWidgetModel'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const { t } = useI18n()
const sourceVideoUrl = computed(() => pickSourceImageUrl(props.state.inputs, 'video'))
const mode = useStrWidget(props.node, 'mode', 'all')
const everyN = useNumWidget(props.node, 'every_n', 1)
const targetFps = useNumWidget(props.node, 'target_fps', 12)
const startS = useNumWidget(props.node, 'start_s', 0)
const endS = useNumWidget(props.node, 'end_s', 0)
const maxFrames = useNumWidget(props.node, 'max_frames', 2000)
const imageFormat = useStrWidget(props.node, 'image_format', 'png')
const jpegQuality = useNumWidget(props.node, 'jpeg_quality', 95)

const modeOptions = computed(() => [
  { value: 'all', label: t('videoToFrames.all') },
  { value: 'every_n', label: t('videoToFrames.interval') },
  { value: 'target_fps', label: t('videoToFrames.fps') },
])
const formatOptions = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
]
</script>

<style scoped>
.ctv-field-row,
.ctv-field-box {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.65rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  background: var(--comfy-input-bg, rgba(255, 255, 255, 0.04));
  color: var(--fg-color, #ddd);
  font-size: 11px;
}
.ctv-field-row > span,
.ctv-field-box > span { flex: 1; color: var(--descrip-text, #999); }
.ctv-field-row input,
.ctv-field-box input {
  width: 5.5rem;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  text-align: right;
  font: inherit;
}
.ctv-field-box input { width: 4.2rem; }
</style>
