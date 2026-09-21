<template>
  <div class="ctv-scroll-thin ctv:flex ctv:w-44 ctv:shrink-0 ctv:flex-col ctv:gap-1 ctv:overflow-y-auto ctv:rounded-lg ctv:bg-node-background ctv:p-1.5" @wheel.stop>

    <div :class="groupHeaderClass">
      <span class="ctv:flex-1">{{ $t('scene3d.addCharacter') }}</span>
      <select
        v-if="availableModels.length > 0"
        value=""
        :class="addSelectClass"
        :aria-label="$t('scene3d.addCharacter')"
        @change="onAddCharacter"
      >
        <option value="" disabled>+</option>
        <option v-for="model in availableModels" :key="model.id" :value="model.id">
          {{ model.name }}
        </option>
      </select>
    </div>
    <Scene3DOutlinerRow
      v-for="(character, index) in state.characters"
      :key="character.id"
      :label="characterDisplayLabel(character)"
      :name="character.name ?? ''"
      :color="characterColor(index)"
      :selected="character.id === selectedId"
      :hidden="!!character.hidden"
      @select="toggleSelectObject(character.id)"
      @rename="(name) => renameObject(character.id, name)"
      @toggle-hide="toggleObjectHidden(character.id)"
      @remove="removeSelected"
    >
      <template #icon><IconPersonStanding class="ctv:size-3 ctv:shrink-0" />
</template>
    </Scene3DOutlinerRow>

    
    <div :class="groupHeaderClass">
      <span class="ctv:flex-1">{{ $t('scene3d.addObject') }}</span>
      <select
        value=""
        :class="addSelectClass"
        :aria-label="$t('scene3d.addObject')"
        @change="onAddPrimitive"
      >
        <option value="" disabled>+</option>
        <option v-for="shape in PRIMITIVE_SHAPES" :key="shape" :value="shape">
          {{ $t(`scene3d.${shape}`) }}
        </option>
      </select>
    </div>
    <Scene3DOutlinerRow
      v-for="primitive in state.primitives"
      :key="primitive.id"
      :label="primitiveDisplayLabel(primitive)"
      :name="primitive.name ?? ''"
      :color="primitive.color"
      :selected="primitive.id === selectedId"
      :hidden="!!primitive.hidden"
      @select="toggleSelectObject(primitive.id)"
      @rename="(name) => renameObject(primitive.id, name)"
      @toggle-hide="toggleObjectHidden(primitive.id)"
      @remove="removeSelected"
    />

    
    <template v-if="modelAssets.length >
 0 || state.models.length > 0">
      <div :class="groupHeaderClass">
        <span class="ctv:flex-1">{{ $t('scene3d.addModel') }}</span>
        <select
          v-if="modelAssets.length > 0"
          value=""
          :class="addSelectClass"
          :aria-label="$t('scene3d.addModel')"
          @change="onAddModel"
        >
          <option value="" disabled>+</option>
          <option v-for="asset in modelAssets" :key="asset.id" :value="String(asset.id)">
            {{ asset.name || `#${asset.id}` }}
          </option>
        </select>
      </div>
      <Scene3DOutlinerRow
        v-for="(model, index) in state.models"
        :key="model.id"
        :label="model.name || model.id"
        :name="model.name"
        :color="modelColor(index)"
        :selected="model.id === selectedId"
        :hidden="!!model.hidden"
        @select="toggleSelectObject(model.id)"
        @rename="(name) => renameObject(model.id, name)"
        @toggle-hide="toggleObjectHidden(model.id)"
        @remove="removeSelected"
      >
        <template #icon><IconBox class="ctv:size-3 ctv:shrink-0" />
</template>
      </Scene3DOutlinerRow>
    </template>

    
    <div :class="groupHeaderClass">
      <span class="ctv:flex-1">{{ $t('scene3d.addLight') }}</span>
      <select
        value=""
        :class="addSelectClass"
        :aria-label="$t('scene3d.lightPresets')"
        :title="$t('scene3d.lightPresets')"
        @change="onApplyLightPreset"
      >
        <option value="" disabled>☀</option>
        <option v-for="preset in LIGHT_PRESET_NAMES" :key="preset" :value="preset">
          {{ $t(`scene3d.preset_${preset}`) }}
        </option>
      </select>
      <select
        value=""
        :class="addSelectClass"
        :aria-label="$t('scene3d.addLight')"
        @change="onAddLight"
      >
        <option value="" disabled>+</option>
        <option v-for="type in LIGHT_TYPES" :key="type" :value="type">
          {{ $t(`scene3d.${type}`) }}
        </option>
      </select>
    </div>
    <Scene3DOutlinerRow
      v-for="light in state.lights"
      :key="light.id"
      :label="lightDisplayLabel(light)"
      :name="light.name ?? ''"
      :selected="light.id === selectedId"
      :hidden="!!light.hidden"
      @select="toggleSelectObject(light.id)"
      @rename="(name) => renameObject(light.id, name)"
      @toggle-hide="toggleObjectHidden(light.id)"
      @remove="removeSelected"
    >
      <template #icon>
        <IconLightbulb class="ctv:size-3 ctv:shrink-0" :style="{ color: light.color }" />
</template>
    </Scene3DOutlinerRow>

    
    <div :class="groupHeaderClass">
      <span class="ctv:flex-1">{{ $t('scene3d.addCamera') }}</span>
      <button
        type="button"
        :class="addSelectClass"
        :aria-label="$t('scene3d.addCamera')"
        @click="addCamera"
      >+</button>
    </div>
    <Scene3DOutlinerRow
      v-for="(cameraEntry, index) in state.cameras"
      :key="cameraEntry.id"
      :label="cameraDisplayLabel(cameraEntry)"
      :name="cameraEntry.name ?? ''"
      :color="cameraEntry.preset ? cameraColor(index) : undefined"
      :selected="cameraEntry.id === selectedId"
      :hidden="!!cameraEntry.hidden"
      @select="toggleSelectObject(cameraEntry.id)"
      @rename="(name) => renameObject(cameraEntry.id, name)"
      @toggle-hide="toggleObjectHidden(cameraEntry.id)"
      @remove="removeSelected"
    >
      <template #icon>
<IconVideo class="ctv:size-3 ctv:shrink-0" />
</template>
      <template v-if="cameraEntry.id === outputCameraId" #badge>
        <span class="ctv:shrink-0 ctv:text-3xs ctv:opacity-70" :title="$t('scene3d.outputCamera')">REC</span>
</template>
    </Scene3DOutlinerRow>

    <div :class="groupHeaderClass">
      <span class="ctv:flex-1">{{ $t('scene3d.addShot') }}</span>
      <button
        type="button"
        :class="addSelectClass"
        :aria-label="$t('scene3d.addShot')"
        :disabled="state.cameras.length === 0"
        @click="addShot"
      >+</button>
    </div>
    <Scene3DOutlinerRow
      v-for="(shot, index) in state.shots"
      :key="shot.id"
      :label="shot.name || `${index + 1} · ${shot.cameraId || $t('scene3d.freeCamera')}`"
      :name="shot.name ?? ''"
      :color="shotColor(shot)"
      :selected="shot.id === selectedId"
      :hidden="false"
      @select="toggleSelectObject(shot.id)"
      @rename="(name) => renameObject(shot.id, name)"
      @remove="removeSelected"
    >
      <template #icon><IconClapperboard class="ctv:size-3 ctv:shrink-0" />
</template>
      <template #badge>
        <span class="ctv:shrink-0 ctv:text-3xs ctv:opacity-70">{{ shot.durFrames }}f</span>
</template>
    </Scene3DOutlinerRow>

    <div :class="groupHeaderClass">
      <span class="ctv:flex-1">{{ $t('scene3d.addPrompt') }}</span>
      <button
        v-if="state.shots.length > 0"
        type="button"
        :class="addSelectClass"
        :aria-label="$t('scene3d.autoPrompts')"
        :title="$t('scene3d.autoPromptsHint')"
        @click="autoFillShotPrompts"
      ><IconWand class="ctv:size-3" /></button>
      <button
        type="button"
        :class="addSelectClass"
        :aria-label="$t('scene3d.addPrompt')"
        @click="addPromptStrip"
      >+</button>
    </div>
    <Scene3DOutlinerRow
      v-for="strip in state.promptTrack"
      :key="strip.id"
      :label="strip.text || $t('scene3d.promptEmpty')"
      :name="''"
      :selected="strip.id === selectedId"
      :hidden="false"
      @select="toggleSelectObject(strip.id)"
      @remove="removeSelected"
    >
      <template #icon><IconMessageSquareText class="ctv:size-3 ctv:shrink-0" />
</template>
      <template #badge>
        <span class="ctv:shrink-0 ctv:text-3xs ctv:opacity-70">{{ strip.range.start }}-{{ strip.range.end }}</span>
</template>
    </Scene3DOutlinerRow>
  </div>
</template>

<script setup lang="ts">
import IconBox from '~icons/lucide/box'
import IconClapperboard from '~icons/lucide/clapperboard'
import IconLightbulb from '~icons/lucide/lightbulb'
import IconMessageSquareText from '~icons/lucide/message-square-text'
import IconPersonStanding from '~icons/lucide/person-standing'
import IconVideo from '~icons/lucide/video'
import IconWand from '~icons/lucide/wand-2'

import Scene3DOutlinerRow from '@/components/widgets/scene3d/Scene3DOutlinerRow.vue'
import type {
  Scene3dStage,
  useScene3dPanels
} from '@/composables/widgets/useScene3dPanels'
import { LIGHT_PRESET_NAMES } from '@/widgets/three/scene3d/lightPresets'
import { LIGHT_TYPES, PRIMITIVE_SHAPES } from '@/widgets/three/scene3d/types'
import type { SceneShotEntry } from '@/widgets/three/scene3d/types'

const props = defineProps<{
  scene3d: Scene3dStage
  panels: ReturnType<typeof useScene3dPanels>
}>()

const {
  state,
  selectedId,
  availableModels,
  modelAssets,
  outputCameraId,
  toggleSelectObject,
  renameObject,
  toggleObjectHidden,
  removeSelected,
  addCamera,
  addShot,
  addPromptStrip,
  autoFillShotPrompts
} = props.scene3d

const {
  characterDisplayLabel,
  primitiveDisplayLabel,
  lightDisplayLabel,
  cameraDisplayLabel,
  characterColor,
  modelColor,
  cameraColor,
  onAddCharacter,
  onAddModel,
  onAddPrimitive,
  onAddLight,
  onApplyLightPreset
} = props.panels

function shotColor(shot: SceneShotEntry): string | undefined {
  const index = state.value.cameras.findIndex(
    (camera) => camera.id === shot.cameraId
  )
  return index >= 0 ? cameraColor(index) : undefined
}

const groupHeaderClass =
  'ctv:flex ctv:items-center ctv:gap-1 ctv:pt-1 ctv:text-3xs ctv:uppercase ctv:tracking-wide ctv:text-muted-foreground'

const addSelectClass =
  'ctv:h-5 ctv:max-w-16 ctv:shrink-0 ctv:cursor-pointer ctv:rounded-md ctv:border-0 ctv:bg-secondary-background ' +
  'ctv:px-1 ctv:text-2xs ctv:text-muted-foreground ctv:outline-none ctv:[font-family:inherit] ' +
  'ctv:hover:bg-secondary-background-hover ctv:hover:text-base-foreground'
</script>
