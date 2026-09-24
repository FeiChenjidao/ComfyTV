import { useToastStore } from '../platform/updates/common/toastStore'

let pending: { message: string; details: string } | null = null

export function useExecutionErrorStore() {
  return {
    recordPromptError(error: { type: string; message: string; details: string }): void {
      pending = { message: error.message, details: error.details }
    },
    showErrorOverlay(): void {
      if (!pending) return
      useToastStore().add({ severity: 'error', summary: pending.message, detail: pending.details, life: 8000 })
      pending = null
    },
  }
}
