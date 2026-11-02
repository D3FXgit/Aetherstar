/** Maps `value` in `[min, max]` onto a clamped -90..90 degree needle sweep. */
export function dialAngleForValue(value: number, min: number, max: number): number {
  const range = max - min
  if (range === 0) return -90

  const fraction = (value - min) / range
  const clampedFraction = Math.max(0, Math.min(1, fraction))
  return -90 + clampedFraction * 180
}
