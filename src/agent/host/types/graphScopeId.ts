export type RootGraphId = string & { readonly __brand: 'RootGraphId' }
export type OwningGraphId = string & { readonly __brand: 'OwningGraphId' }

export function toRootGraphId(id: string): RootGraphId {
  return id as RootGraphId
}

export function toOwningGraphId(id: string): OwningGraphId {
  return id as OwningGraphId
}
