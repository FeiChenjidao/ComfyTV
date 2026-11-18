import { z } from 'zod'

export const IgnisTokenSchema = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  hint: z.string().optional().default(''),
  saved: z.boolean().optional().default(false),
  error: z.string().optional().default(''),
})

export type IgnisToken = z.infer<typeof IgnisTokenSchema>
