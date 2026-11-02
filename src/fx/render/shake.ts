/** Camera-free screen shake: a random-direction offset that linearly decays to zero over `durationMs`. */
export function computeShakeOffset(
  elapsedMs: number,
  durationMs: number,
  maxOffsetPx: number,
  random: () => number = Math.random,
): { x: number; y: number } {
  if (elapsedMs >= durationMs) return { x: 0, y: 0 }

  const remaining = 1 - elapsedMs / durationMs
  const magnitude = maxOffsetPx * remaining
  const angle = random() * Math.PI * 2

  return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude }
}
