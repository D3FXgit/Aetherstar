import type { FrameStats } from './types'

/**
 * Rolling fps/frame-time from a buffer of consecutive rAF `performance.now()`
 * timestamps (oldest first, newest last). Averages every delta in the buffer rather than just the last one, so a single stall
 * shows up as a dip instead of being masked by otherwise-steady frames.
 */
export function computeFrameStats(frameTimestampsMs: number[]): FrameStats {
  if (frameTimestampsMs.length < 2) return { fps: 0, frameTimeMs: 0 }

  const deltas: number[] = []
  for (let i = 1; i < frameTimestampsMs.length; i++) {
    deltas.push(frameTimestampsMs[i] - frameTimestampsMs[i - 1])
  }

  const frameTimeMs = deltas.reduce((sum, d) => sum + d, 0) / deltas.length
  const fps = frameTimeMs > 0 ? 1000 / frameTimeMs : 0

  return { fps, frameTimeMs }
}
