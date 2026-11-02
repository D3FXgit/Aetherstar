import { useEffect, useState } from 'react'
import { formatCaptureKey } from '../../multiplayer/captureKey'
import { usePitchStore } from '../pitchStore'

/**
 * How long after the last frame the meter keeps showing the level it was given.
 *
 * The native side emits a frame roughly every 30ms per capture (a level-only
 * one when the input is silent), and batches flush every 2-3 frames, so a
 * healthy capture updates several times per hold window. Anything longer than
 * this is a stream that has actually stopped.
 */
export const LEVEL_HOLD_MS = 250

/**
 * How long the held level takes to reach zero once it goes stale.
 *
 * A capture that stops emitting must fall to zero rather than freeze: a frozen
 * bar shows a dead mic as live, which is the precise misdiagnosis these meters
 * exist to prevent. It's a ramp rather than a cliff so the eye reads it as an
 * input dropping out, not as a rendering glitch.
 */
export const LEVEL_DECAY_MS = 400

/** How often a held level is re-checked for staleness while nothing is arriving. */
const STALENESS_TICK_MS = 80

/**
 * The level to show for a capture whose last frame arrived `ageMs` ago.
 *
 * Exported for its own tests: this is the whole staleness policy, and it is
 * pure, whereas the timing around it is not.
 */
export function decayedLevel(level: number, ageMs: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0
  if (ageMs <= LEVEL_HOLD_MS) return level
  if (ageMs >= LEVEL_HOLD_MS + LEVEL_DECAY_MS) return 0
  return level * (1 - (ageMs - LEVEL_HOLD_MS) / LEVEL_DECAY_MS)
}

/** Live RMS amplitude (0..1) for one bound input; 0 when nothing is capturing it. */
export function useCaptureLevel(deviceId: string | null, channelIndex: number): number {
  const key = deviceId === null ? null : formatCaptureKey(deviceId, channelIndex)

  // An unbound row, a device with no active capture, and a capture that has not
  // yet produced a frame all collapse to the same (0, 0) here, so there is one
  // path to zero rather than four.
  const level = usePitchStore((state) => (key === null ? 0 : (state.activeCaptures[key]?.level ?? 0)))
  const levelAt = usePitchStore((state) => (key === null ? 0 : (state.activeCaptures[key]?.levelAt ?? 0)))

  const [value, setValue] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }

    const tick = () => {
      const next = levelAt === 0 ? 0 : decayedLevel(level, Date.now() - levelAt)
      setValue((previous) => (previous === next ? previous : next))
      // Fully decayed: nothing left to animate until the next frame arrives,
      // and eight of these run at once on a full matrix.
      if (next === 0) stop()
    }

    tick()
    // Only a non-zero level has anywhere to decay to. A store update restarts
    // this effect, so a capture that resumes picks the timer back up.
    if (level > 0 && levelAt > 0 && Date.now() - levelAt < LEVEL_HOLD_MS + LEVEL_DECAY_MS) {
      timer = setInterval(tick, STALENESS_TICK_MS)
    }

    return stop
  }, [level, levelAt])

  return value
}
