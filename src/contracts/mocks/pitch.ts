import type { PitchSample } from '../types'

const SINGABLE_MIN_HZ = 80
const SINGABLE_MAX_HZ = 1100
const MAX_STEP_HZ = 40
const DEFAULT_HZ = 220 // roughly A3, a comfortable starting pitch

/** Deterministic-shape (bounded random walk) mock pitch sample generator. */
export function generatePitchSample(prev: PitchSample | null, t: number, deviceId: string): PitchSample {
  const prevHz = prev?.hz ?? DEFAULT_HZ
  const step = (Math.random() * 2 - 1) * MAX_STEP_HZ
  const hz = clamp(prevHz + step, SINGABLE_MIN_HZ, SINGABLE_MAX_HZ)

  return {
    t,
    hz,
    confidence: 0.7 + Math.random() * 0.3,
    deviceId,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
