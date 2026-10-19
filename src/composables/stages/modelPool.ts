import { setWidget } from '@/composables/stages/spawnFollowUp'
import {
  computePickedFromBatch,
  imagePoolCount,
  nextPickerPool,
  toImagePoolJson,
  type StageState,
  useStageStore,
} from '@/stores/stageStore'

type Store = ReturnType<typeof useStageStore>

/** Merge a freshly executed model URL into the stage pool (Append/Replace). */
export function mergeModelOutputIntoPool(
  node: any,
  state: StageState,
  store: Store,
  url: string | null | undefined,
): void {
  if (state.kind !== 'model' || state.variant !== 'generator') return
  const s = String(url ?? '').trim()
  if (!s) return
  const appendW = node?.widgets?.find((w: any) => w.name === 'append_results')
  const append = !appendW || appendW.value !== false
  const before = imagePoolCount(state.pool)
  const merged = nextPickerPool(state.pool, toImagePoolJson(s), append)
  store.setPickerPool(node, state, merged)
  const added = imagePoolCount(merged) - before
  if (!append || added > 0) {
    state.pickedIndex = 1
    setWidget(node, 'selected_index', 1)
  }
}

/** Select a pool item by 1-based index and publish it as the live model output. */
export function pickModelPoolIndex(
  node: any,
  state: StageState,
  store: Store,
  idx: number,
): void {
  if (state.kind !== 'model') return
  const safe = Number.isFinite(idx) && idx >= 1 ? Math.floor(idx) : 1
  const count = Math.max(imagePoolCount(state.pool), 1)
  const clamped = Math.min(safe, count)
  state.pickedIndex = clamped
  setWidget(node, 'selected_index', clamped)
  const url = computePickedFromBatch(toImagePoolJson(state.pool), clamped)
  if (url !== state.output) store.setOutputSlot(state, 0, url)
}
