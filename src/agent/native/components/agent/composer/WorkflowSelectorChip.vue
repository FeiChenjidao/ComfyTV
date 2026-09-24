<script setup lang="ts">
import { cn } from '@comfyorg/tailwind-utils'
import {
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@agent/components/ui/button/Button.vue'
import Input from '@agent/components/ui/input/Input.vue'
import AccessibleTooltip from '@agent/components/ui/tooltip/AccessibleTooltip.vue'
import { useWorkflowTabActivityStore } from '@agent/stores/workflowTabActivityStore'

import type { ActiveTab } from '../../../types/activeTab'

const {
  activeTab,
  tabs,
  visibleTabPath = null,
  selectingTabPath = null,
  selectTab = async () => false,
  detached = false,
  disabled = false
} = defineProps<{
  activeTab: ActiveTab | null
  tabs: ActiveTab[]
  visibleTabPath?: string | null
  selectingTabPath?: string | null
  selectTab?: (path: string) => Promise<boolean>
  detached?: boolean
  disabled?: boolean
}>()

const { t } = useI18n()
const tabActivity = useWorkflowTabActivityStore()

const current = computed(() => (detached ? null : activeTab))
const workflowTooltipText = computed(() =>
  current.value
    ? t('agent.changeWorkflowForChat')
    : t('agent.chooseWorkflowForChat')
)

const open = ref(false)
const query = ref('')
const searchInput = ref<InstanceType<typeof Input>>()
const selectorRoot = useTemplateRef<HTMLElement>('selectorRoot')
const composerReference = computed(
  () => selectorRoot.value?.parentElement?.parentElement ?? undefined
)

watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  await nextTick()
  searchInput.value?.focus()
})

function openPicker(): void {
  if (!disabled) open.value = true
}

defineExpose({ openPicker })

function onOpenChange(value: boolean): void {
  if (selectingTabPath === null) open.value = value
}

async function onSelectTab(path: string): Promise<void> {
  if (disabled || selectingTabPath !== null) return
  if (await selectTab(path)) open.value = false
}

const tabSections = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()
  const filteredTabs = tabs.filter((tab) =>
    tab.name.toLowerCase().includes(normalizedQuery)
  )
  const visibleTab = filteredTabs.find((tab) => tab.path === visibleTabPath)
  const otherTabs = filteredTabs.filter((tab) => tab.path !== visibleTabPath)

  return [
    {
      key: 'current',
      label: t('agent.currentTab'),
      tabs: visibleTab ? [visibleTab] : []
    },
    {
      key: 'other',
      label: visibleTab ? t('agent.otherOpenWorkflows') : undefined,
      tabs: otherTabs
    }
  ].filter((section) => section.tabs.length > 0)
})

// Suppress keys from the dropdown's typeahead while typing in the search box,
// but let Escape bubble to reka's dismiss (a window keydown listener) so the
// menu still closes from the focused input.
function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') event.stopPropagation()
}
</script>

<template>
  <div
    ref="selectorRoot"
    class="ctv:flex ctv:w-full ctv:items-center ctv:justify-between ctv:gap-1.5"
  >
    <DropdownMenuRoot :open @update:open="onOpenChange">
      <AccessibleTooltip
        :label="workflowTooltipText"
        side="top"
        align="start"
        :skip-delay-duration="0"
        disable-hoverable-content
        :disable-closing-trigger="false"
        :collision-padding="8"
      >
        <template #trigger>
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              :variant="current ? 'textonly' : 'outline'"
              size="unset"
              :disabled
              :aria-label="t('agent.switchWorkflow')"
              :class="
                cn(
                  'ctv:group ctv:h-7 ctv:min-w-0 ctv:gap-2 ctv:px-2.5 ctv:text-xs/4 ctv:font-normal',
                  current && 'ctv:flex-1'
                )
              "
            >
              <span
                v-if="tabActivity.editingTabPath === current?.path"
                role="img"
                :aria-label="t('g.agentWorking')"
                class="ctv:icon-[lucide--loader-circle] ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground ctv:motion-safe:animate-spin"
              />
              <span
                v-else
                data-testid="workflow-selector-icon"
                class="ctv:icon-[comfy--workflow] ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground ctv:group-hover:text-base-foreground"
              />
              <span class="ctv:min-w-0 ctv:truncate">{{
                current?.name ?? t('agent.selectWorkflowForAgent')
              }}</span>
              <span
                v-if="current?.isPersisted === false || current?.modified"
                data-testid="unsaved-dot"
                class="ctv:flex ctv:size-3.5 ctv:shrink-0 ctv:items-center ctv:justify-center"
              >
                <span class="ctv:size-[7px] ctv:rounded-full ctv:bg-base-foreground" />
              </span>
            </Button>
          </DropdownMenuTrigger>
        </template>
      </AccessibleTooltip>
      <DropdownMenuPortal>
        <DropdownMenuContent
          side="top"
          align="start"
          :side-offset="8"
          :reference="composerReference"
          class="agent-scope ctv:z-1100 ctv:box-border ctv:w-(--reka-dropdown-menu-trigger-width) ctv:overflow-hidden ctv:rounded-lg ctv:border ctv:border-border-subtle ctv:bg-secondary-background ctv:p-1 ctv:font-inter ctv:shadow-lg"
        >
          <Input
            ref="searchInput"
            v-model="query"
            :disabled="selectingTabPath !== null"
            type="text"
            :placeholder="t('agent.searchWorkflows')"
            class="ctv:mb-1 ctv:h-8 ctv:bg-base-background ctv:px-2.5 ctv:py-1"
            @keydown="onSearchKeydown"
          />
          <DropdownMenuRadioGroup
            :model-value="current?.path ?? ''"
            class="ctv:max-h-52 ctv:overflow-y-auto"
            @update:model-value="(value) => onSelectTab(String(value))"
          >
            <div
              v-for="section in tabSections"
              :key="section.key"
              role="group"
              :aria-label="section.label"
            >
              <div
                v-if="section.label"
                aria-hidden="true"
                class="ctv:px-1.5 ctv:py-1 ctv:text-[11px]/4 ctv:font-medium ctv:text-muted-foreground"
              >
                {{ section.label }}
              </div>
              <DropdownMenuRadioItem
                v-for="tab in section.tabs"
                :key="tab.path"
                :value="tab.path"
                :disabled="disabled || selectingTabPath !== null"
                :aria-busy="selectingTabPath === tab.path || undefined"
                class="ctv:box-border ctv:flex ctv:h-7 ctv:w-full ctv:cursor-pointer ctv:items-center ctv:gap-1.5 ctv:rounded-lg ctv:px-1.5 ctv:py-1 ctv:text-[14px]/5 ctv:font-normal ctv:text-base-foreground ctv:outline-none ctv:data-highlighted:bg-secondary-background-hover"
                @select.prevent
              >
                <span
                  v-if="selectingTabPath === tab.path"
                  role="status"
                  class="ctv:flex ctv:size-4 ctv:shrink-0 ctv:items-center ctv:justify-center"
                >
                  <span
                    class="ctv:icon-[lucide--loader-circle] ctv:size-4 ctv:text-muted-foreground ctv:motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  <span class="ctv:sr-only">{{ t('agent.savingWorkflow') }}</span>
                </span>
                <span
                  v-else-if="tabActivity.editingTabPath === tab.path"
                  role="img"
                  :aria-label="t('g.agentWorking')"
                  class="ctv:icon-[lucide--loader-circle] ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground ctv:motion-safe:animate-spin"
                />
                <span
                  v-else
                  class="ctv:icon-[comfy--workflow] ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground"
                />
                <span class="ctv:min-w-0 ctv:truncate">{{ tab.name }}</span>
                <span
                  v-if="tabActivity.unseenModifiedPaths.has(tab.path)"
                  role="img"
                  :aria-label="t('g.agentModified')"
                  class="ctv:flex ctv:size-4 ctv:shrink-0 ctv:items-center ctv:justify-center"
                >
                  <span class="ctv:size-2 ctv:rounded-full ctv:bg-primary-background" />
                </span>
                <span
                  v-else-if="tab.isPersisted === false || tab.modified"
                  data-testid="unsaved-dot"
                  class="ctv:flex ctv:size-4 ctv:shrink-0 ctv:items-center ctv:justify-center"
                >
                  <span class="ctv:size-2 ctv:rounded-full ctv:bg-base-foreground" />
                </span>
                <span
                  class="ctv:ml-auto ctv:flex ctv:size-4 ctv:shrink-0 ctv:items-center ctv:justify-center"
                >
                  <DropdownMenuItemIndicator
                    class="ctv:flex ctv:size-4 ctv:items-center ctv:justify-center"
                  >
                    <span
                      aria-hidden="true"
                      class="ctv:icon-[lucide--bot] ctv:size-2.5 ctv:text-brand-yellow"
                    />
                  </DropdownMenuItemIndicator>
                </span>
              </DropdownMenuRadioItem>
            </div>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </div>
</template>
