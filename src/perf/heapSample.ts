export interface MemoryLike {
  usedJSHeapSize: number
}

/**
 * Reads a Chromium-only `performance.memory`-shaped object, converting bytes
 * to MB. Returns null (not NaN, no throw) when unavailable, so the perf
 * overlay degrades gracefully outside Chromium.
 */
export function readHeapSampleMb(memory: MemoryLike | undefined): number | null {
  if (!memory) return null
  return memory.usedJSHeapSize / (1024 * 1024)
}
