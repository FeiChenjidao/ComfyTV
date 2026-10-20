import { z } from 'zod'

export const PluginUpdateStatusSchema = z.object({
  ok: z.boolean(),
  is_repo: z.boolean(),
  has_git: z.boolean(),
  update_available: z.boolean(),
  local_version: z.string(),
  remote_version: z.string().optional().default(''),
  local_sha: z.string().optional().default(''),
  remote_sha: z.string().optional().default(''),
  behind: z.number().optional().default(0),
  ahead: z.number().optional().default(0),
  dirty: z.boolean().optional().default(false),
  branch: z.string().optional().default(''),
  remote: z.string().optional().default(''),
  remote_url: z.string().optional().default(''),
  restart_required: z.boolean().optional().default(false),
  forced: z.boolean().optional(),
  error: z.string().optional().default(''),
  error_code: z.string().optional().default(''),
})
export type PluginUpdateStatus = z.infer<typeof PluginUpdateStatusSchema>
