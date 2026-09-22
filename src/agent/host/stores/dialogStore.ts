interface DialogOptions {
  key?: string
  title?: string
  props?: Record<string, unknown>
  [option: string]: unknown
}

export function useDialogStore() {
  return {
    showDialog(options: DialogOptions): void {
      const url = options.props?.modelUrl
      if (typeof url === 'string') window.open(url, '_blank', 'noopener')
    },
    updateDialog(_options: DialogOptions): void {},
    closeDialog(_options?: { key?: string }): void {},
  }
}
