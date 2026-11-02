/**
 * Reads where the host's song clock has got to, live, without touching the
 * stage. The position lives only on the clock `<audio>` element (never in a
 * store, which would re-render the stage every frame), so this reads that
 * element and is polled at 10 Hz -- the audience runs its own clock between
 * anchors (see ./useAudienceStageClock.ts).
 */
import { usePauseStore } from '../stage/pause/pauseStore'
import { useCalibrationStore } from '../calibration/calibrationStore'
import { clampCalibrationOffsetMs } from '../calibration/offsets'
import type { AudiencePlayback } from './types'

/** The anchor as read off the host's clock, pause state included. */
export type MirroredPlayback = AudiencePlayback

/** The contract this reader depends on, spelled once. */
const CLOCK_ELEMENT_SELECTOR = 'audio[data-testid="stage-clock-audio"]'

/** How often the host's clock is re-read while a song is playing. */
export const STAGE_CLOCK_MIRROR_POLL_MS = 100

/**
 * How far the position must move before it is worth re-broadcasting.
 *
 * A paused clock re-read ten times a second must not publish ten identical
 * payloads a second down a channel the whole audience screen re-renders from.
 * Any real playback moves ~100 ms per poll, so this only ever suppresses a
 * genuinely stationary clock.
 */
const POSITION_EPSILON_MS = 1

/** The host's clock element, or null when no song is on screen. */
export function readStageClock(root: ParentNode = document): MirroredPlayback | null {
  const element = root.querySelector<HTMLAudioElement>(CLOCK_ELEMENT_SELECTOR)
  if (!element) return null

  const positionMs = element.currentTime * 1000
  if (!Number.isFinite(positionMs)) return null

  const pause = usePauseStore.getState()
  return {
    positionMs,
    atEpochMs: Date.now(),
    // `ended` too: a stalled element is not `paused`, and a clock that has
    // stopped while claiming to play would scroll the audience past the end.
    paused: element.paused || element.ended,
    pausedByHost: pause.phase !== 'running',
    epoch: pause.restartToken,
    // The same clamped offset Sing/JukeboxScene add to #GAP on this stage.
    gapOffsetMs: clampCalibrationOffsetMs(useCalibrationStore.getState().settings.outputOffsetMs),
  }
}

/** True when two readings describe a clock that has not moved -- used to avoid re-broadcasting a stationary song. */
export function sameStageClock(a: MirroredPlayback | null, b: MirroredPlayback | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.paused === b.paused &&
    a.pausedByHost === b.pausedByHost &&
    a.epoch === b.epoch &&
    (a.gapOffsetMs ?? 0) === (b.gapOffsetMs ?? 0) &&
    Math.abs(a.positionMs - b.positionMs) < POSITION_EPSILON_MS
  )
}

/**
 * Poll the host's clock, calling `onChange` only when it has actually moved (or
 * stopped, or gone away). Returns the stop function.
 */
export function watchStageClock(
  onChange: (playback: MirroredPlayback | null) => void,
  intervalMs: number = STAGE_CLOCK_MIRROR_POLL_MS,
): () => void {
  let previous: MirroredPlayback | null = null

  const read = () => {
    const playback = readStageClock()
    if (sameStageClock(playback, previous)) return
    previous = playback
    onChange(playback)
  }

  read()
  const timer = setInterval(read, intervalMs)
  return () => clearInterval(timer)
}
