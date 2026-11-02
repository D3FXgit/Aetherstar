/**
 * Pairs each tap with the commanded time at the same index and returns the
 * mean signed offset in ms: a plain arithmetic mean, no outlier rejection.
 */
export function averageOffsetMs(commandedTimesMs: number[], tapTimesMs: number[]): number {
  const count = Math.min(commandedTimesMs.length, tapTimesMs.length)
  if (count === 0) return 0

  let sum = 0
  for (let i = 0; i < count; i++) {
    sum += tapTimesMs[i] - commandedTimesMs[i]
  }
  return sum / count
}
