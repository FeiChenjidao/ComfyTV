export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.warn('[ComfyTV/agent]', context?.errorType ?? 'error', error)
}
