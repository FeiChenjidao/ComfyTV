<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, nextTick, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'

import Button from '@agent/components/ui/button/Button.vue'
import Input from '@agent/components/ui/input/Input.vue'
import AccessibleTooltip from '@agent/components/ui/tooltip/AccessibleTooltip.vue'

import type {
  ChatSession,
  HistoryGroups
} from '../../stores/agent/agentChatHistoryStore'

const { groups } = defineProps<{ groups: HistoryGroups }>()
const emit = defineEmits<{
  back: []
  select: [id: string]
  delete: [id: string]
  copyMarkdown: [id: string]
  rename: [id: string, title: string]
}>()

const { t } = useI18n()

const sections = computed(() =>
  (
    [
      ['current', t('agent.historyCurrent'), groups.current],
      ['today', t('agent.historyToday'), groups.today],
      ['yesterday', t('agent.historyYesterday'), groups.yesterday],
      ['earlier', t('agent.historyEarlier'), groups.earlier]
    ] as const
  ).filter(([, , items]) => items.length > 0)
)

const isEmpty = computed(() => sections.value.length === 0)

function pick(session: ChatSession): void {
  emit('select', session.id)
}

const MAX_TITLE_LENGTH = 200

const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const selectOnFocus = ref(false)

function startRename(session: ChatSession): void {
  renamingId.value = session.id
  renameDraft.value = session.title
  selectOnFocus.value = true
}

// Runs on every mount of the editor, so a row that regroups mid-rename gets
// focus back; selecting is confined to the fresh open so a remount cannot
// wipe what the user has already typed.
function focusInput(el: Element | ComponentPublicInstance | null): void {
  const input: unknown = el instanceof Element ? el : el?.$el
  if (!(input instanceof HTMLInputElement)) return
  const shouldSelect = selectOnFocus.value
  selectOnFocus.value = false
  // Deferred because the ref fires before the element is in the document and
  // before v-model has written the draft, so focusing here directly would
  // leave the caret at the end instead of selecting the existing title.
  void nextTick(() => {
    // The row can unmount within the tick (rapid regroup, delete); focusing a
    // detached element is a silent no-op in browsers, but bail explicitly
    // instead of relying on that quirk.
    if (!input.isConnected) return
    input.focus()
    if (shouldSelect) input.select()
  })
}

function cancelRename(): void {
  renamingId.value = null
}

function commitRename(session: ChatSession): void {
  // Idempotence guard: commit is reachable from both Enter and blur, so a
  // second call for an already-ended rename must not emit a duplicate.
  if (renamingId.value !== session.id) return
  renamingId.value = null
  const title = renameDraft.value.trim()
  if (title !== '' && title !== session.title.trim())
    emit('rename', session.id, title)
}

// Fence reka-ui's close focus-restore only when a rename was just started
// (@select fires before this event, so renamingId is already set on that
// path); otherwise let Escape/outside-click return focus to the trigger so
// keyboard users keep their place.
function onMenuCloseAutoFocus(event: Event): void {
  if (renamingId.value !== null) event.preventDefault()
}

function onRenameKeydown(session: ChatSession, event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename(session)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}
</script>

<template>
  <div class="ctv:flex ctv:h-full ctv:flex-col ctv:overflow-hidden">
    <div class="ctv:flex ctv:h-10 ctv:shrink-0 ctv:items-center ctv:gap-1 ctv:px-2">
      <AccessibleTooltip
        :label="t('agent.backToPreviousChat')"
        side="bottom"
        :skip-delay-duration="0"
        disable-hoverable-content
        :collision-padding="8"
      >
        <template #trigger>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon-sm"
            :aria-label="t('agent.backToPreviousChat')"
            class="ctv:size-6 ctv:shrink-0"
            @click="emit('back')"
          >
            <span class="ctv:icon-[lucide--chevron-left] ctv:size-4 ctv:shrink-0" />
          </Button>
        </template>
      </AccessibleTooltip>
      <h2 class="ctv:m-0 ctv:text-xs ctv:font-normal ctv:text-muted-foreground">
        {{ t('agent.history') }}
      </h2>
    </div>

    <div class="ctv:min-h-0 ctv:flex-1 ctv:overflow-y-auto ctv:p-2">
      <p
        v-if="isEmpty"
        class="ctv:px-2 ctv:py-8 ctv:text-center ctv:text-sm ctv:text-muted-foreground"
      >
        {{ t('agent.historyEmpty') }}
      </p>

      <section v-for="[key, label, items] in sections" :key class="ctv:mb-3">
        <p class="ctv:my-0 ctv:px-2 ctv:py-1 ctv:text-xs ctv:font-medium ctv:text-muted-foreground">
          {{ label }}
        </p>
        <div
          v-for="session in items"
          :key="session.id"
          class="ctv:group ctv:flex ctv:items-center ctv:gap-2 ctv:rounded-sm ctv:px-2 ctv:py-1 ctv:hover:bg-secondary-background-hover"
        >
          <div
            v-if="renamingId === session.id"
            class="ctv:flex ctv:min-w-0 ctv:flex-1 ctv:items-center"
          >
            <span
              class="ctv:icon-[lucide--circle-check] ctv:size-4 ctv:shrink-0 ctv:text-muted-foreground"
            />
            <Input
              :ref="focusInput"
              v-model="renameDraft"
              type="text"
              :aria-label="t('g.rename')"
              :maxlength="MAX_TITLE_LENGTH"
              class="ctv:h-6 ctv:flex-1 ctv:px-2 ctv:py-1 ctv:text-xs"
              @keydown="onRenameKeydown(session, $event)"
              @blur="commitRename(session)"
            />
          </div>
          <template v-else>
            <Button
              type="button"
              variant="muted-textonly"
              size="unset"
              class="ctv:min-w-0 ctv:flex-1 ctv:justify-start ctv:text-left ctv:text-xs ctv:font-normal"
              @click="pick(session)"
            >
              <span class="ctv:icon-[lucide--circle-check] ctv:size-4 ctv:shrink-0" />
              <span class="ctv:truncate">{{
                session.title.trim() || t('agent.untitledChat')
              }}</span>
            </Button>
            <AccessibleTooltip
              :label="t('agent.copyMarkdown')"
              :skip-delay-duration="0"
              disable-hoverable-content
              :collision-padding="8"
            >
              <template #trigger>
                <Button
                  type="button"
                  variant="muted-textonly"
                  size="icon-sm"
                  class="ctv:shrink-0"
                  :aria-label="t('agent.copyMarkdown')"
                  @click="emit('copyMarkdown', session.id)"
                >
                  <span class="ctv:icon-[lucide--copy] ctv:size-3.5" />
                </Button>
              </template>
            </AccessibleTooltip>
            <DropdownMenuRoot>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="muted-textonly"
                  size="icon-sm"
                  class="ctv:size-6 ctv:shrink-0"
                  :aria-label="t('agent.chatOptions')"
                >
                  <span class="ctv:icon-[lucide--chevron-down] ctv:size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  side="bottom"
                  align="end"
                  :side-offset="4"
                  class="agent-scope ctv:z-1100 ctv:flex ctv:w-32 ctv:flex-col ctv:gap-1 ctv:overflow-clip ctv:rounded-lg ctv:bg-secondary-background ctv:p-1 ctv:shadow-md ctv:ring-1 ctv:ring-border-subtle ctv:ring-inset"
                  @close-auto-focus="onMenuCloseAutoFocus"
                >
                  <DropdownMenuItem
                    class="ctv:flex ctv:h-6 ctv:w-full ctv:shrink-0 ctv:cursor-pointer ctv:items-center ctv:gap-1.5 ctv:rounded-lg ctv:px-1.5 ctv:py-1 ctv:text-xs ctv:text-base-foreground ctv:outline-none ctv:data-highlighted:bg-secondary-background-hover"
                    @select="startRename(session)"
                  >
                    <span class="ctv:icon-[lucide--pencil] ctv:size-4 ctv:shrink-0" />
                    <span class="ctv:truncate">{{ t('g.rename') }}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator
                    class="ctv:relative ctv:h-0 ctv:w-full ctv:shrink-0 ctv:before:absolute ctv:before:inset-x-0 ctv:before:top-0 ctv:before:h-px ctv:before:bg-component-node-border"
                  />
                  <DropdownMenuItem
                    class="ctv:flex ctv:h-6 ctv:w-full ctv:shrink-0 ctv:cursor-pointer ctv:items-center ctv:gap-1.5 ctv:rounded-lg ctv:px-1.5 ctv:py-1 ctv:text-xs ctv:text-base-foreground ctv:outline-none ctv:data-highlighted:bg-secondary-background-hover ctv:data-highlighted:text-destructive-background"
                    @select="emit('delete', session.id)"
                  >
                    <span class="ctv:icon-[lucide--trash-2] ctv:size-4 ctv:shrink-0" />
                    <span class="ctv:truncate">{{ t('g.delete') }}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
