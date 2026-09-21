<template>
  <div class="ctv-scroll-thin ctv:flex ctv:w-64 ctv:shrink-0 ctv:flex-col ctv:gap-1.5 ctv:overflow-y-auto ctv:rounded-lg ctv:bg-node-background ctv:p-1.5" @wheel.stop>
    <span :class="inspectorHeaderClass">{{ objectsSummary }}</span>
    <Scene3DCharacterPanel
      v-if="selectedCharacter"
      :character="selectedCharacter"
      :clip-names="clipNamesForSelected"
      pathable
      :has-path="!!selectedCharacter.path"
      tintable
      :tint="selectedCharacter.color ?? ''"
      @update-animation="updateSelectedAnimation"
      @update-transform="updateSelectedTransform"
      @add-path="addCharacterPathById(selectedCharacter!.id)"
      @remove-path="removeCharacterPathById(selectedCharacter!.id)"
      @update-tint="(color) => setCharacterColorById(selectedCharacter!.id, color)"
    />
    <Scene3DPrimitivePanel
      v-else-if="selectedPrimitive"
      :primitive="selectedPrimitive"
      @update-color="(color) => updateSelectedPrimitive({ color })"
      @update-transform="updateSelectedTransform"
    />
    <Scene3DLightPanel
      v-else-if="selectedLight"
      :light="selectedLight"
      @update-light="updateSelectedLight"
    />
    <Scene3DCharacterPanel
      v-else-if="selectedModel"
      :character="selectedModel"
      :clip-names="clipNamesForSelected"
      fittable
      @update-animation="updateSelectedAnimation"
      @update-transform="updateSelectedTransform"
      @fit="fitSelectedModel"
    />
    <Scene3DCameraPanel
      v-else-if="selectedCamera"
      :camera="selectedCamera"
      :presets="cameraPresets"
      :looking-through="lookThroughId === selectedCamera.id"
      @bind-preset="(id) => bindCameraPreset(selectedCamera!.id, id)"
      @update-tuning="(tuning) => updateCameraTuning(selectedCamera!.id, tuning)"
      @set-fov="(fov) => setCameraFov(selectedCamera!.id, fov)"
      @update-transform="updateSelectedTransform"
      @toggle-view="toggleLookThrough(selectedCamera!.id)"
    />
    <Scene3DPromptPanel
      v-else-if="selectedPrompt"
      :strip="selectedPrompt"
      @patch="(patch) => patchPromptById(selectedPrompt!.id, patch)"
    />
    <Scene3DShotPanel
      v-else-if="selectedShot"
      :shot="selectedShot"
      :cameras="shotCameraOptions"
      :characters="shotLockOptions"
      :index="state.shots.findIndex((entry) => entry.id === selectedShot!.id)"
      :count="state.shots.length"
      @patch="(patch) => patchShotById(selectedShot!.id, patch)"
      @move="(delta) => moveShotBy(selectedShot!.id, delta)"
    />
    <div v-else class="ctv:px-1 ctv:text-2xs ctv:text-muted-foreground">
      {{ $t('scene3d.noSelection') }}
    </div>

    <div class="ctv:my-0.5 ctv:border-b ctv:border-border-subtle" />

    
    <span :class="inspectorHeaderClass">{{ $t('scene3d.environment') }}</span>
    <div class="ctv:flex ctv:flex-wrap ctv:items-center ctv:gap-x-3 ctv:gap-y-1.5 ctv:px-1">
      <label class="ctv:flex ctv:cursor-pointer ctv:items-center ctv:gap-1.5">
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('scene3d.showGrid') }}</span>
        <ComfyTVToggle
          :model-value="state.environment.showGrid"
          @update:model-value="(v) => updateEnvironment({ showGrid: v })"
        />
      </label>
      <label class="ctv:flex ctv:cursor-pointer ctv:items-center ctv:gap-1.5">
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('scene3d.showRoom') }}</span>
        <ComfyTVToggle
          :model-value="state.environment.showRoom"
          @update:model-value="(v) => updateEnvironment({ showRoom: v })"
        />
      </label>
      <label v-if="state.environment.showRoom" class="ctv:flex ctv:cursor-pointer ctv:items-center ctv:gap-1.5">
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('scene3d.floorOnly') }}</span>
        <ComfyTVToggle
          :model-value="!!state.environment.floorOnly"
          @update:model-value="(v) => updateEnvironment({ floorOnly: v })"
        />
      </label>
      <label class="ctv:flex ctv:cursor-pointer ctv:items-center ctv:gap-1.5">
        <span class="ctv:text-2xs ctv:text-muted-foreground">{{ $t('scene3d.background') }}</span>
        <ComfyTVToggle
          :model-value="state.environment.background !== ''"
          @update:model-value="(v) => updateEnvironment({ background: v ? '#222222' : '' })"
        />
        <input
          v-if="state.environment.background"
          type="color"
          :value="state.environment.background"
          class="ctv:h-6 ctv:w-8 ctv:cursor-pointer ctv:rounded-md ctv:border-0 ctv:bg-transparent ctv:p-0"
          @input="onBackgroundInput"
        />
      </label>
    </div>

    <div class="ctv:my-0.5 ctv:border-b ctv:border-border-subtle" />

    
    <span :class="inspectorHeaderClass">{{ $t('scene3d.sectionOutput') }}</span>
    <Scene3DOutputPanel
      :width="outputWidth"
      :height="outputHeight"
      :channel="channel"
      :fps="state.output.fps"
      :frame-count="state.output.frameCount"
      :cameras="outputCameraOptions"
      :camera-id="outputCameraId || FREE_CAMERA_VALUE"
      @set-size="setOutputSize"
      @set-channel="setChannel"
      @set-fps="setOutputFps"
      @set-frame-count="setOutputFrameCount"
      @set-camera="onSetOutputCamera"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import ComfyTVToggle from '@/components/widgets/ComfyTVToggle.vue'
import Scene3DCameraPanel from '@/components/widgets/scene3d/Scene3DCameraPanel.vue'
import Scene3DCharacterPanel from '@/components/widgets/scene3d/Scene3DCharacterPanel.vue'
import Scene3DLightPanel from '@/components/widgets/scene3d/Scene3DLightPanel.vue'
import Scene3DOutputPanel from '@/components/widgets/scene3d/Scene3DOutputPanel.vue'
import Scene3DPrimitivePanel from '@/components/widgets/scene3d/Scene3DPrimitivePanel.vue'
import Scene3DPromptPanel from '@/components/widgets/scene3d/Scene3DPromptPanel.vue'
import Scene3DShotPanel from '@/components/widgets/scene3d/Scene3DShotPanel.vue'
import {
  FREE_CAMERA_VALUE,
  type Scene3dStage,
  type useScene3dPanels
} from '@/composables/widgets/useScene3dPanels'

const props = defineProps<{
  scene3d: Scene3dStage
  panels: ReturnType<typeof useScene3dPanels>
}>()

const {
  state,
  selectedCharacter,
  selectedPrimitive,
  selectedLight,
  selectedModel,
  selectedCamera,
  selectedShot,
  selectedPrompt,
  clipNamesForSelected,
  cameraPresets,
  lookThroughId,
  outputCameraId,
  outputWidth,
  outputHeight,
  channel,
  fitSelectedModel,
  updateSelectedAnimation,
  updateSelectedTransform,
  updateSelectedPrimitive,
  updateSelectedLight,
  updateEnvironment,
  addCharacterPathById,
  removeCharacterPathById,
  setCharacterColorById,
  bindCameraPreset,
  updateCameraTuning,
  setCameraFov,
  toggleLookThrough,
  patchPromptById,
  patchShotById,
  moveShotBy,
  setOutputSize,
  setChannel,
  setOutputFps,
  setOutputFrameCount
} = props.scene3d

const {
  characterDisplayLabel,
  cameraDisplayLabel,
  outputCameraOptions,
  onSetOutputCamera,
  objectsSummary,
  onBackgroundInput
} = props.panels

const shotCameraOptions = computed(() =>
  state.value.cameras.map((camera) => ({
    value: camera.id,
    label: cameraDisplayLabel(camera)
  }))
)

const shotLockOptions = computed(() =>
  state.value.characters.map((character) => ({
    value: character.id,
    label: characterDisplayLabel(character)
  }))
)

const inspectorHeaderClass =
  'ctv:px-1 ctv:text-3xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground'
</script>
