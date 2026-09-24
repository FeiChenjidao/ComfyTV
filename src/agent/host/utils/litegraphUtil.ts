export function isLGraphNode(item: unknown): item is any {
  const ctor = (window as any).LGraphNode ?? (window as any).LiteGraph?.LGraphNode
  if (ctor) return item instanceof ctor
  return (
    typeof item === 'object' && item !== null && 'id' in item && 'graph' in item
    && typeof (item as any).getInputInfo === 'function'
  )
}
