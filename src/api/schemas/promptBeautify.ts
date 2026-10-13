import { z } from 'zod'

export const PromptBeautifyResultSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  model: z.string(),
})
export type PromptBeautifyResult = z.infer<typeof PromptBeautifyResultSchema>
