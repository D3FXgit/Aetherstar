/** Picks a random sample index, avoiding an immediate repeat of `previousIndex` when more than one sample exists. */
export function pickVariation(sampleCount: number, previousIndex: number | null): number {
  if (sampleCount <= 1) return 0

  let next = Math.floor(Math.random() * sampleCount)
  while (next === previousIndex) {
    next = Math.floor(Math.random() * sampleCount)
  }
  return next
}
