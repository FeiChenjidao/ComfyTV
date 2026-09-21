<template>
  <Teleport to="body" :disabled="!fullscreen">
    <div
      class="ctv:flex ctv:flex-col ctv:gap-1 ctv:text-xs ctv:text-base-foreground"
      :class="fullscreen
        ? 'ctv:fixed ctv:inset-0 ctv:z-[1400] ctv:bg-base-background ctv:p-2'
        : 'ctv:size-full'"
      @pointerdown.stop
      @mousedown.stop
      @contextmenu.stop.prevent
    >

      <div class="ctv:flex ctv:h-8 ctv:shrink-0 ctv:items-center ctv:gap-2">
        <div
          class="ctv:flex ctv:h-7 ctv:items-center ctv:gap-0.5 ctv:rounded-lg ctv:bg-secondary-background ctv:p-0.5"
          :class="allGizmoDisabled ? 'ctv:opacity-40' : ''"
          :title="gizmoDisabledHint"
        >
          <button
            v-for="option in gizmoOptions"
            :key="option.value"
            type="button"
            :class="gizmoBtnClass(gizmoMode === option.value)"
            :aria-pressed="gizmoMode === option.value"
            :title="$t(option.labelKey)"
            :disabled="gizmoModeDisabled(option.value)"
            @click="setGizmoMode(option.value)"
          >
            <component :is="option.icon" class="ctv:size-3.5" />
            {{ $t(option.labelKey) }}
          </button>
        </div>

        <div class="ctv:h-5 ctv:w-px ctv:bg-border-subtle" />

        <button
          type="button"
          :class="historyBtnClass"
          :disabled="!canUndo"
          :title="$t('scene3d.undo')"
          @click="undo"
        >
          <IconUndo class="ctv:size-4" />
        </button>
        <button
          type="button"
          :class="historyBtnClass"
          :disabled="!canRedo"
          :title="$t('scene3d.redo')"
          @click="redo"
        >
          <IconRedo class="ctv:size-4" />
        </button>

        <div class="ctv:h-5 ctv:w-px ctv:bg-border-subtle" />

        <button
          type="button"
          :class="actionBtnClass"
          :disabled="capturing || recording"
          @click="capture"
        >
          <IconLoader v-if="capturing" class="ctv:size-3.5 ctv:animate-spin" />
          <IconCamera v-else class="ctv:size-3.5" />
          {{ $t('scene3d.capture') }}
        </button>
        <button
          type="button"
          :class="actionBtnClass"
          :disabled="capturing || recording || !recordingSupported || !hasRecordableDuration"
          :title="recordTitle"
          @click="record"
        >
          <IconLoader v-if="recording" class="ctv:size-3.5 ctv:animate-spin" />
          <IconVideo v-else class="ctv:size-3.5" />
          {{ recording ? recordingLabel : $t('scene3d.record') }}
        </button>

        <div class="ctv:flex-1" />

        <button
          type="button"
          :class="iconToolBtnClass"
          :title="$t('scene3d.planView')"
          :aria-pressed="planView"
          @click="togglePlanView"
        >
          <IconMap class="ctv:size-4" :class="planView ? 'ctv:text-base-foreground' : ''" />
        </button>

        <button
          type="button"
          :class="iconToolBtnClass"
          :title="$t(fullscreen ? 'scene3d.exitFullscreen' : 'scene3d.fullscreen')"
          @click="toggleFullscreen"
        >
          <IconMinimize v-if="fullscreen" class="ctv:size-4" />
          <IconMaximize v-else class="ctv:size-4" />
        </button>
      </div>

      <div class="ctv:flex ctv:min-h-0 ctv:flex-1 ctv:gap-1">

        <Scene3DOutliner :scene3d="scene3d" :panels="panels" />

        
        <div
          class="ctv:relative ctv:min-w-0 ctv:flex-1 ctv:overflow-hidden ctv:rounded-lg ctv:bg-black"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <SceneCanvas :init-scene="initScene" />
          <button
            v-if="lookThroughId"
            type="button"
            class="ctv:absolute ctv:top-2 ctv:right-2 ctv:z-10 ctv:inline-flex ctv:cursor-pointer ctv:items-center ctv:gap-1
                   ctv:rounded-lg ctv:border-0 ctv:bg-black/60 ctv:px-2 ctv:py-1 ctv:text-2xs ctv:text-white
                   ctv:transition-colors ctv:hover:bg-black/80 ctv:[font-family:inherit]"
            @click="toggleLookThrough(lookThroughId)"
          >
            <IconEyeOff class="ctv:size-3" />
            {{ $t('scene3d.exitLookThrough') }}
          </button>
          
          <div
            v-if="pipCameraId && !lookThroughId"
            class="ctv:absolute ctv:right-2 ctv:bottom-2 ctv:z-10 ctv:flex ctv:items-center ctv:gap-1"
          >
            
            <button
              type="button"
              class="ctv:inline-flex ctv:cursor-pointer ctv:items-center ctv:justify-center
                     ctv:rounded-lg ctv:border-0 ctv:bg-black/60 ctv:p-1 ctv:text-white
                     ctv:transition-colors ctv:hover:bg-black/80 ctv:[font-family:inherit]"
              :title="$t('scene3d.switchToPipView')"
              @click="toggleLookThrough(pipCameraId)"
            >
              <IconEye class="ctv:size-3" />
            </button>
            <button
              type="button"
              class="ctv:inline-flex ctv:cursor-pointer ctv:items-center ctv:gap-1
                     ctv:rounded-lg ctv:border-0 ctv:bg-black/60 ctv:px-1.5 ctv:py-0.5 ctv:text-2xs ctv:text-white
                     ctv:transition-colors ctv:hover:bg-black/80 ctv:[font-family:inherit]"
              :title="$t('scene3d.closePipPreview')"
              @click="setPipCamera(null)"
            >
              {{ pipCameraId }}
              <IconX class="ctv:size-3" />
            </button>
          </div>
        </div>

        
        <Scene3DInspector :scene3d="scene3d" :panels="panels" />
      </div>

      
      <div
        v-if="timelineData && (timelineData.cameras.length > 0 || timelineData.characters.length > 0 || (timelineData.shots?.length ?? 0) > 0)"
        class="ctv:shrink-0 ctv:rounded-lg ctv:bg-node-background ctv:p-1.5"
      >
        <Scene3DTimelineTracks
          v-model:loop="timelineLoop"
          :data="timelineData"
          :legend="timelineLegend"
          :frame="timelineFrame"
          :playing="timelinePlaying"
          :selected-id="selectedId"
          @seek="handleTimelineSeek"
          @toggle-play="handleTimelineTogglePlay"
          @camera-speed="setCameraSpeedById"
          @character-patch="updateCharacterAnimationById"
          @track-select="toggleSelectObject"
          @shot-duration="setShotDurationById"
          @shot-move="moveShotToIndex"
        />
      </div>

      
      <StageCard
        class="ctv:h-auto! ctv:grow-0 ctv:shrink-0"
        :state="stageState"
        :node="node"
        :on-run-request="onRunRequest"
        :on-cancel-request="onCancelRequest"
        :on-disconnect="onDisconnect"
        :on-action="onAction"
        hide-context
        hide-output
        hide-actions
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import IconBan from '~icons/lucide/ban'
import IconCamera from '~icons/lucide/camera'
import IconEye from '~icons/lucide/eye'
import IconEyeOff from '~icons/lucide/eye-off'
import IconLoader from '~icons/lucide/loader-2'
import IconMap from '~icons/lucide/map'
import IconMaximize from '~icons/lucide/maximize-2'
import IconMinimize from '~icons/lucide/minimize-2'
import IconVideo from '~icons/lucide/video'
import IconMove3d from '~icons/lucide/move-3d'
import IconRedo from '~icons/lucide/redo-2'
import IconRotate3d from '~icons/lucide/rotate-3d'
import IconScale3d from '~icons/lucide/scale-3d'
import IconUndo from '~icons/lucide/undo-2'
import IconX from '~icons/lucide/x'

import type { LGraphNode } from '@/lib/comfyApp'
import StageCard from '@/components/stages/StageCard.vue'
import SceneCanvas from '@/components/widgets/SceneCanvas.vue'
import Scene3DInspector from '@/components/widgets/scene3d/Scene3DInspector.vue'
import Scene3DOutliner from '@/components/widgets/scene3d/Scene3DOutliner.vue'
import Scene3DTimelineTracks from '@/components/widgets/scene3d/Scene3DTimelineTracks.vue'
import { useScene3dStage } from '@/composables/widgets/useScene3dStage'
import {
  useScene3dFullscreen,
  useScene3dOutputSlots,
  useScene3dPanels
} from '@/composables/widgets/useScene3dPanels'
import type { StageState } from '@/stores/stageStore'
import type { Scene3dGizmoMode } from '@/widgets/three/scene3d/Scene3dViewport'

const props = defineProps<{
  state: StageState
  onRunRequest: () => void
  onCancelRequest: () => void
  onDisconnect: (slot: string) => void
  onAction: (id: string) => void
  node: LGraphNode
}>()

const stageState = props.state

const { syncOutputSlots } = useScene3dOutputSlots(props.node, stageState)

const scene3d = useScene3dStage(props.node, {
  onCaptured: (url) => syncOutputSlots(url, undefined),
  onRecorded: (url) => syncOutputSlots(undefined, url)
})

const {
  initScene,
  cleanup,
  handleMouseEnter,
  handleMouseLeave,
  selectedId,
  gizmoMode,
  undo,
  redo,
  canUndo,
  canRedo,
  toggleSelectObject,
  setGizmoMode,
  setCameraSpeedById,
  lookThroughId,
  toggleLookThrough,
  pipCameraId,
  setPipCamera,
  timelinePlaying,
  timelineFrame,
  timelineLoop,
  handleTimelineTogglePlay,
  handleTimelineSeek,
  updateCharacterAnimationById,
  setShotDurationById,
  moveShotToIndex,
  planView,
  togglePlanView,
  capturing,
  recording,
  recordingSupported,
  hasRecordableDuration,
  capture,
  record
} = scene3d

const panels = useScene3dPanels(scene3d)
const {
  timelineData,
  timelineLegend,
  gizmoModeDisabled,
  allGizmoDisabled,
  gizmoDisabledHint,
  recordingLabel,
  recordTitle
} = panels

const gizmoOptions = [
  { value: 'none' as Scene3dGizmoMode, labelKey: 'scene3d.gizmoNone', icon: IconBan },
  { value: 'translate' as Scene3dGizmoMode, labelKey: 'scene3d.gizmoTranslate', icon: IconMove3d },
  { value: 'rotate' as Scene3dGizmoMode, labelKey: 'scene3d.gizmoRotate', icon: IconRotate3d },
  { value: 'scale' as Scene3dGizmoMode, labelKey: 'scene3d.gizmoScale', icon: IconScale3d }
]

const { fullscreen, toggleFullscreen, onFullscreenKeydown } = useScene3dFullscreen()

onMounted(() => {
  syncOutputSlots()
  window.addEventListener('keydown', onFullscreenKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFullscreenKeydown, true)
  cleanup()
})

const actionBtnClass =
  'ctv:inline-flex ctv:h-7 ctv:items-center ctv:justify-center ctv:gap-1.5 ctv:cursor-pointer ctv:[font-family:inherit] ' +
  'ctv:rounded-lg ctv:border-0 ctv:bg-secondary-background ctv:px-2.5 ' +
  'ctv:text-xs ctv:text-base-foreground ctv:transition-colors ' +
  'ctv:hover:bg-secondary-background-hover ' +
  'ctv:disabled:cursor-not-allowed ctv:disabled:opacity-40 ctv:disabled:hover:bg-secondary-background'

const iconToolBtnClass =
  'ctv:inline-flex ctv:size-7 ctv:shrink-0 ctv:cursor-pointer ctv:items-center ctv:justify-center ' +
  'ctv:rounded-lg ctv:border-0 ctv:bg-secondary-background ctv:text-muted-foreground ctv:transition-colors ' +
  'ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground'

const historyBtnClass =
  iconToolBtnClass +
  ' ctv:disabled:cursor-not-allowed ctv:disabled:opacity-40 ' +
  'ctv:disabled:hover:bg-secondary-background ctv:disabled:hover:text-muted-foreground'

function gizmoBtnClass(active: boolean) {
  return (
    'ctv:flex ctv:cursor-pointer ctv:items-center ctv:justify-center ctv:gap-1 ctv:self-stretch ctv:px-2 ' +
    'ctv:rounded-md ctv:border-0 ctv:text-2xs ctv:transition-colors ctv:outline-none ctv:[font-family:inherit] ' +
    (active
      ? 'ctv:bg-secondary-background-selected ctv:text-base-foreground'
      : 'ctv:bg-transparent ctv:text-muted-foreground ctv:hover:text-base-foreground')
  )
}
</script>
