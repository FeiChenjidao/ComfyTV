export function useAccountPreconditionDialog() {
  return {
    open(_kind: 'credits' | 'subscription'): void {},
  }
}
