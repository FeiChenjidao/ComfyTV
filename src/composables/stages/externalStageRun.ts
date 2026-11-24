/**
 * Decide whether a queue-triggered stage result belongs on this card.
 *
 * ComfyUI's queue is a second way into the plugin: the `comfy` CLI, a script or
 * an agent can submit a stage node to `/prompt`, and the backend broadcasts the
 * outcome to every page (see runners/stage_events.py). Such a run is not tied
 * to a prompt this page started, so the normal job-id matching would drop it.
 */

export interface ExternalStageRunContext {
  nodeId: string | number
  projectId: string
  /** Prompt this page is running itself, if any. */
  runPromptId: string | null
  running: boolean
  runStageRunId: string | null
}

export function shouldApplyExternalRun(
  d: any,
  ctx: ExternalStageRunContext,
): boolean {
  if (!d || d.external !== true) return false
  if (String(d.node_id ?? '') !== String(ctx.nodeId)) return false
  if (d.project_id && ctx.projectId && String(d.project_id) !== ctx.projectId) return false
  // Ignore the echo of a prompt this page queued itself (bridge-in runs).
  if (d.prompt_id && ctx.runPromptId && String(d.prompt_id) === ctx.runPromptId) return false
  // Never overwrite a run the card is currently driving.
  if (ctx.running || ctx.runStageRunId) return false
  return d.status === 'done' || d.status === 'error'
}
