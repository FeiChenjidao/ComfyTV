import { z } from 'zod'

export const NativeWorkflowGitFileSchema = z.object({
  path: z.string(),
  dirty: z.boolean(),
  remote_diff: z.boolean(),
  can_update: z.boolean(),
  can_commit: z.boolean(),
  untracked: z.boolean().optional().default(false),
  /** new | modified | outdated | diverged */
  state: z.string().optional(),
})

export const NativeWorkflowGitStatusSchema = z.object({
  ok: z.boolean(),
  is_repo: z.boolean(),
  root: z.string(),
  branch: z.string(),
  remote: z.string(),
  ahead: z.number(),
  behind: z.number(),
  dirty: z.boolean(),
  changes: z.array(z.string()),
  files: z.array(NativeWorkflowGitFileSchema).default([]),
  has_git: z.boolean(),
  error: z.string(),
  error_code: z.string().optional(),
  fetch_error: z.string().optional(),
  default_remote: z.string().optional(),
  user_id: z.string().optional(),
  setup: z.boolean().optional(),
  pulled: z.boolean().optional(),
  pushed: z.boolean().optional(),
  path: z.string().optional(),
  paths: z.array(z.string()).optional(),
  duplicates: z.array(z.string()).optional(),
  assets_packed: z.number().optional(),
  assets_restored: z.number().optional(),
  assets_skipped: z.number().optional(),
  assets_warnings: z.array(z.string()).optional(),
})
export type NativeWorkflowGitStatus = z.infer<typeof NativeWorkflowGitStatusSchema>
export type NativeWorkflowGitFile = z.infer<typeof NativeWorkflowGitFileSchema>
