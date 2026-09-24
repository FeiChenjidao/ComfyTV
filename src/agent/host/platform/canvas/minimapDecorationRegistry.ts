export interface MinimapDecorationLayer {
  replace(items: unknown[]): void
  dispose(): void
}

export function registerMinimapDecorationLayer(_id: string): MinimapDecorationLayer {
  return {
    replace(): void {},
    dispose(): void {},
  }
}
