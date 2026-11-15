import { fetchWorkflowConfig } from '@/api'
import type { WorkflowConfig } from '@/api/schemas'
import { imageSlotsFromConfig } from '@/composables/stages/assetSlots'
import { useSelectionStore } from '@/stores/selectionStore'

const MODEL_IMAGE_INPUT_RE = /^images\.image(\d+)$/

export interface ModelImageInputProfile {
  roles: string[]
  boundSlots: number[]
}

export type SlotLabelTranslator = (
  key: string,
  params?: Record<string, unknown>,
) => string

export function modelImageInputProfileFromConfig(
  config: Pick<WorkflowConfig, 'exposed_widgets' | 'meta'>,
): ModelImageInputProfile {
  const rawRoles = config.meta?.model_image_slots
  const roles = Array.isArray(rawRoles)
    ? rawRoles.map(role => typeof role === 'string' ? role.trim() : '')
    : []
  return {
    roles,
    boundSlots: imageSlotsFromConfig(config.exposed_widgets).map(option => option.slot),
  }
}

export function modelImageInputLabel(
  role: string | undefined,
  index: number,
  translate: SlotLabelTranslator,
): string {
  switch (role) {
    case 'front': return translate('stage.modelInput.front')
    case 'left': return translate('stage.modelInput.left')
    case 'back': return translate('stage.modelInput.back')
    case 'right': return translate('stage.modelInput.right')
    case 'extra': return translate('stage.modelInput.extra')
    case 'reference': return translate('stage.modelInput.reference', { n: index + 1 })
    default: return role || translate('stage.modelInput.image', { n: index + 1 })
  }
}

export function applyModelImageInputProfile(
  node: any,
  profile: ModelImageInputProfile | null,
  translate: SlotLabelTranslator,
): void {
  const boundSlots = profile ? new Set(profile.boundSlots) : null
  let changed = false
  for (const input of node?.inputs ?? []) {
    const match = MODEL_IMAGE_INPUT_RE.exec(String(input?.name ?? ''))
    if (!match) continue
    const index = Number(match[1])
    const label = modelImageInputLabel(profile?.roles[index], index, translate)
    if (input.label !== label) {
      input.label = label
      changed = true
    }
    if (input.localized_name !== label) {
      input.localized_name = label
      changed = true
    }
    const hidden = boundSlots == null ? false : !boundSlots.has(index) && input.link == null
    if (input.hidden !== hidden) {
      input.hidden = hidden
      changed = true
    }
  }
  if (changed) node?.setDirtyCanvas?.(true, true)
}

const profileCache = new Map<string, Promise<ModelImageInputProfile>>()

export function fetchModelImageInputProfileCached(
  kind: string,
  label: string,
): Promise<ModelImageInputProfile> {
  const version = useSelectionStore().bindingsVersion
  const key = `${kind}::${label}::v${version}`
  let hit = profileCache.get(key)
  if (!hit) {
    profileCache.clear()
    hit = fetchWorkflowConfig(kind, label)
      .then(modelImageInputProfileFromConfig)
      .catch((error) => {
        profileCache.delete(key)
        throw error
      })
    profileCache.set(key, hit)
  }
  return hit
}
