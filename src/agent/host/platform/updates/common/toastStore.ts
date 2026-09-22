import { hostManager } from '../../../pinia'

interface ToastMessage {
  severity?: 'success' | 'info' | 'warn' | 'error'
  summary?: string
  detail?: string
  life?: number
}

export function useToastStore() {
  return {
    add(message: ToastMessage): void {
      const toast = hostManager()?.toast
      if (toast?.add) toast.add(message)
      else console.info('[ComfyTV/agent]', message.summary ?? '', message.detail ?? '')
    },
  }
}
