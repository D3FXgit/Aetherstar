const MIN_RATE = 0.95
const MAX_RATE = 1.05
const CORRECTION_GAIN = 0.05 // rate adjustment per 1000ms of audio/video desync

/** Desync smaller than this is left alone: a rate change costs a decoder adjustment and buys nothing here. */
export const RATE_DEADBAND_MS = 20

/** Rates are quantised to this step, so a jittering desync does not write a new rate every frame. */
export const RATE_QUANTUM = 0.005

/**
 * How far the stage's video may be out of step before it is hard-seeked rather
 * than rate-nudged -- by the clock loop every frame, and by a start or resume.
 */
export const VIDEO_SEEK_THRESHOLD_MS = 250

/** After this many hard seeks that did not land, a source stops being hard-seeked and is only nudged. */
export const MAX_FAILED_VIDEO_SEEKS = 3

/**
 * Where the video should be, in its own time, for a given audio position.
 *
 * UltraStar Deluxe shows the video frame at **audio + `#VIDEOGAP`**: a positive
 * gap means the video's first seconds are an intro the song skips, so at audio
 * 0 the video is already `gap` in.
 */
export function videoTargetMs(audioMs: number, videoGapMs: number): number {
  return audioMs + videoGapMs
}

/**
 * Nudges video's playback rate toward the audio clock -- audio is always the
 * source of truth (never the reverse). `videoGapMs` is `#VIDEOGAP` in ms; see
 * `videoTargetMs` for which way it points.
 *
 * Inside ±RATE_DEADBAND_MS the base rate is returned exactly, and every other
 * answer is quantised to RATE_QUANTUM, so callers that only assign on change
 * write a new rate a handful of times a song rather than every frame.
 */
export function computeVideoPlaybackRate(input: {
  audioMs: number
  videoMs: number
  videoGapMs: number
  baseRate?: number
}): number {
  const { audioMs, videoMs, videoGapMs, baseRate = 1 } = input
  const desyncMs = videoTargetMs(audioMs, videoGapMs) - videoMs
  if (Math.abs(desyncMs) <= RATE_DEADBAND_MS) return baseRate
  const nudge = (desyncMs / 1000) * CORRECTION_GAIN
  const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, baseRate + nudge))
  return Number((Math.round(rate / RATE_QUANTUM) * RATE_QUANTUM).toFixed(3))
}

/**
 * Bookkeeping for hard video seeks, per source.
 *
 * A source whose decoder cannot land a seek (a long-GOP file, a half-transcoded
 * file) would otherwise be re-seeked forever, flushing its decoder each time.
 * After MAX_FAILED_VIDEO_SEEKS seeks in a row that left it out of step, it is
 * only rate-nudged from then on.
 */
export interface VideoSeekTracker {
  /** The source these counts belong to; a new src starts over. */
  src: string | null
  failures: number
  /** True between issuing a seek and judging whether it landed. */
  awaitingVerdict: boolean
  lastSeekAtMs: number
}

export function createVideoSeekTracker(): VideoSeekTracker {
  return { src: null, failures: 0, awaitingVerdict: false, lastSeekAtMs: Number.NEGATIVE_INFINITY }
}

/**
 * Whether to hard-seek now. Mutates `tracker`: records the seek it allows, and
 * the verdict on the previous one once the element has finished seeking.
 */
export function shouldHardSeekVideo(
  tracker: VideoSeekTracker,
  input: {
    src: string | null
    desyncMs: number
    nowMs: number
    seeking: boolean
    /** readyState >= HAVE_CURRENT_DATA (or METADATA, for a caller that can seek earlier). */
    canSeek: boolean
    thresholdMs: number
    minIntervalMs: number
  },
): boolean {
  if (tracker.src !== input.src) {
    tracker.src = input.src
    tracker.failures = 0
    tracker.awaitingVerdict = false
    tracker.lastSeekAtMs = Number.NEGATIVE_INFINITY
  }
  if (input.seeking) return false

  const outOfStep = Math.abs(input.desyncMs) > input.thresholdMs
  if (tracker.awaitingVerdict) {
    tracker.awaitingVerdict = false
    tracker.failures = outOfStep ? tracker.failures + 1 : 0
  }
  if (tracker.failures >= MAX_FAILED_VIDEO_SEEKS) return false
  if (!outOfStep || !input.canSeek || input.nowMs - tracker.lastSeekAtMs <= input.minIntervalMs) return false

  tracker.lastSeekAtMs = input.nowMs
  tracker.awaitingVerdict = true
  return true
}

/**
 * The time to seek a video to, in seconds, or null when it must not be seeked:
 * never before 0 (a negative-gap video holds its first frame instead) and never
 * at or past its end (a video shorter than the song simply stays ended).
 */
export function videoSeekTargetSec(targetMs: number, durationSec: number): number | null {
  if (targetMs < 0) return null
  const targetSec = targetMs / 1000
  if (Number.isFinite(durationSec) && durationSec > 0 && targetSec >= durationSec) return null
  return targetSec
}
