export interface Pooled<T> {
  item: T
  active: boolean
}

/** Fixed-size pool -- never grows, so a burst never triggers per-frame allocation. */
export function createPool<T>(size: number, factory: () => T): Pooled<T>[] {
  return Array.from({ length: size }, () => ({ item: factory(), active: false }))
}

/** Returns the first inactive entry, or null when the pool is exhausted (caller drops the particle). */
export function acquire<T>(pool: Pooled<T>[]): Pooled<T> | null {
  const entry = pool.find((p) => !p.active)
  if (!entry) return null
  entry.active = true
  return entry
}

export function release<T>(pooled: Pooled<T>): void {
  pooled.active = false
}
