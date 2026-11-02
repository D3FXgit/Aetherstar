/** baseVolume dipped by duckAmount (0..1), clamped to [0, 1]. */
export function computeDuckedVolume(baseVolume: number, duckAmount: number): number {
  const ducked = baseVolume * (1 - duckAmount)
  return Math.min(1, Math.max(0, ducked))
}
