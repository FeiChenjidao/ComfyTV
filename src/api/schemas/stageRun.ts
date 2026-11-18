import { z } from 'zod'

export const StageRunStartSchema = z.object({
  job_id: z.string(),
})

export type StageRunStart = z.infer<typeof StageRunStartSchema>
