import { z } from 'zod'

export const NativeWorkflowGitFileSchema = z.object({
  path: z.string(),
  dirty: z.boolean(),
  remote_diff: z.boolean(),
  can_update: z.boolean(),
  can_commit: z.boolean(),
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
  pulled: z.boolean().optional(),
  pushed: z.boolean().optional(),
  path: z.string().optional(),
  paths: z.array(z.string()).optional(),
  duplicates: z.array(z.string()).optional(),
})
export type NativeWorkflowGitStatus = z.infer<typeof NativeWorkflowGitStatusSchema>
export type NativeWorkflowGitFile = z.infer<typeof NativeWorkflowGitFileSchema>
