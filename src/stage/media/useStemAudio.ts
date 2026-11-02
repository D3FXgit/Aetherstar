import { useAnimationFrame } from 'framer-motion'
import { useEffect, useRef, type RefObject } from 'react'
import { useHitStore } from '../../game/state/useHitStore'
import { logSongLoad } from '../../diagnostics/log'
import { duckTargetGain, isDuckingTier, nextDuckGain } from './duckEnvelope'
import { computeStemCorrection } from './stemSync'

export interface StemFrameState {
  /** Current linear gain applied to the stem element. */
  gain: number
  /** Timestamp of the previous frame, for a frame-rate-independent ramp. */
  lastFrameMs: number | null
  /** When the singer last landed a note, or null if they never have. */
  lastQualifyingHitAtMs: number | null
  /** Latched once the stem is too far out to recover; it is silenced and left alone from then on. */
  abandoned: boolean
}

export const INITIAL_STEM_FRAME_STATE: StemFrameState = {
  gain: 1,
  lastFrameMs: null,
  lastQualifyingHitAtMs: null,
  abandoned: false,
}

/**
 * One frame of guide-vocal handling: follow the clock, correct drift, apply
 * the ducking envelope. Exported separately from the hook so the wiring is
 * testable without a real animation frame.
 *
 * The clock element is read and never written. Everything this function
 * changes -- currentTime, playbackRate, volume, paused -- belongs to the stem.
 */
export function applyStemFrame(input: {
  clock: HTMLMediaElement
  stem: HTMLMediaElement
  nowMs: number
  state: StemFrameState
  /**
   * The guide vocal's own level: the song's loudness normalisation times the
   * mixer's *guide vocals* channel (see useSongGain). Omitted, the stem rides
   * the clock element's volume.
   */
  guideVolume?: number
}): StemFrameState {
  const { clock, stem, nowMs, state, guideVolume } = input
  const dtMs = state.lastFrameMs === null ? 0 : nowMs - state.lastFrameMs
  const next: StemFrameState = { ...state, lastFrameMs: nowMs }

  // Latched: a stem that could not be pulled back stays silent for the rest of
  // the song rather than being chased. See stemSync.ts -- seeking it back into
  // place costs more playback time than it recovers.
  if (state.abandoned) return next

  // The stem is a passenger: it plays exactly when the clock does. Pausing,
  // seeking or ending the clock element must not leave a vocal track running
  // on its own.
  if (clock.paused || clock.ended) {
    if (!stem.paused) stem.pause()
    return next
  }

  if (stem.paused) {
    // Landing on the clock's position and then starting is the one place a
    // seek is allowed, because the element is not playing: there is no
    // in-flight playback for the seek to cost. Starting first and seeking
    // after would play a burst of audio from the wrong place.
    stem.currentTime = clock.currentTime
    void Promise.resolve(stem.play()).catch(() => {
      // A refused play() on the guide vocal is survivable -- the instrumental
      // is the clock and the song keeps going without it.
    })
    return next
  }

  const correction = computeStemCorrection({ clockMs: clock.currentTime * 1000, stemMs: stem.currentTime * 1000 })
  if (correction.abandon) {
    stem.volume = 0
    stem.pause()
    next.abandoned = true
    next.gain = 0
    return next
  }
  // Rate only. Never `stem.currentTime` while it is playing -- that measurably
  // costs 55-80ms of playback and makes the drift worse, not better.
  if (stem.playbackRate !== correction.playbackRate) {
    stem.playbackRate = correction.playbackRate
  }

  const target = duckTargetGain(state.lastQualifyingHitAtMs === null ? null : nowMs - state.lastQualifyingHitAtMs)
  next.gain = nextDuckGain({ current: state.gain, target, dtMs })
  // Never absolute. `state.gain` is the ducking envelope, 0..1, and the song
  // carries a loudness-normalisation gain (src/audio/loudness.ts) -- so writing
  // the envelope straight into `stem.volume` would play the guide vocal 12 dB
  // over the backing track on every song the normalisation pulled down. The
  // guide's own level is the same normalisation through the mixer's guide-vocal
  // channel, so the user's guide-vocal fader actually moves it; without one,
  // the clock's volume stands in.
  stem.volume = clampVolume(next.gain * (guideVolume ?? clock.volume))

  return next
}

/** `HTMLMediaElement.volume` throws outside 0..1, and this is a product of two ramps. */
function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Drives the separated vocal stem alongside the authoritative clock element.
 *
 * Does nothing at all unless `stemRef` points at a real element, so every
 * stemless song -- which is almost all of them -- behaves exactly as before.
 */
export function useStemAudio(input: {
  clockRef: RefObject<HTMLMediaElement | null>
  stemRef: RefObject<HTMLMediaElement | null>
  /** False when the plan decided not to use stems; the hook then stays inert. */
  enabled: boolean
  /** The guide vocal's level (normalisation x the guide-vocal mixer channel). See applyStemFrame. */
  guideVolume?: number
}): void {
  const { clockRef, stemRef, enabled, guideVolume } = input
  const stateRef = useRef<StemFrameState>(INITIAL_STEM_FRAME_STATE)
  // Read by the frame loop and the start-up effect without re-running either.
  const guideVolumeRef = useRef(guideVolume)
  useEffect(() => {
    guideVolumeRef.current = guideVolume
  }, [guideVolume])

  // Hit events are read by subscription rather than by rendering on them: the
  // score store fires per note and this must not re-render the stage. Only the
  // arrival time is kept, so nothing here depends on how HitEvent.t is stamped.
  useEffect(() => {
    if (!enabled) return
    return useHitStore.subscribe((store, previous) => {
      const latest = store.latest
      if (!latest || latest === previous.latest) return
      if (isDuckingTier(latest.tier)) {
        stateRef.current = { ...stateRef.current, lastQualifyingHitAtMs: performance.now() }
      }
    })
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    stateRef.current = { ...INITIAL_STEM_FRAME_STATE }
    const stem = stemRef.current
    if (!stem) return
    // Chromium time-stretches rather than pitch-shifts by default, which is
    // what makes the +/-1% drift nudge inaudible. Being explicit means a
    // different default never silently turns drift correction into vibrato.
    stem.preservesPitch = true
    // The guide's own level, not 1: the rAF loop would correct this on its
    // first frame anyway, but "its first frame" is up to 16 ms of the guide
    // vocal playing over a normalised backing track at full scale.
    stem.volume = clampVolume(guideVolumeRef.current ?? clockRef.current?.volume ?? 1)
    logSongLoad('media:stems-active', { stemSrc: stem.currentSrc || stem.src })
  }, [enabled, stemRef, clockRef])

  useAnimationFrame((nowMs) => {
    if (!enabled) return
    const clock = clockRef.current
    const stem = stemRef.current
    if (!clock || !stem) return
    stateRef.current = applyStemFrame({ clock, stem, nowMs, state: stateRef.current, guideVolume: guideVolumeRef.current })
  })
}
