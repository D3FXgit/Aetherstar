import { useAnimationFrame, useMotionValue, type MotionValue } from 'framer-motion'
import { useMemo, useRef } from 'react'
import type { SongMeta } from '../contracts/types'
import { msPerBeat, msToBeat } from '../stage/timing/beatMs'
import type { AudiencePlayback } from './types'

/**
 * The audience window's own song clock, run from the host's broadcast anchor.
 *
 * ---------------------------------------------------------------------------
 * Why the audience runs a clock at all
 *
 * The note lanes scroll and the backdrop video plays, and both need a position
 * *every frame*. The broadcast cannot supply one: `AUDIENCE_SCORE_STATE` is
 * coalesced to one send per 34 ms in the main process and drops the values in
 * between by design, so a lane positioned straight from arriving payloads
 * would advance in 34 ms steps whenever the relay fired and freeze whenever it
 * did not. A lane that stutters is worse than no lane.
 *
 * What arrives instead is an *anchor* -- "the host's clock read `positionMs` at
 * `atEpochMs`" -- and this hook extrapolates it in real time, on the audience's
 * own animation frame, exactly the way `useStageClock` extrapolates
 * `audio.currentTime` on the host's. Both windows are the same machine, so
 * `Date.now()` is a shared clock and the extrapolation is honest.
 *
 * ---------------------------------------------------------------------------
 * Why the correction is a filter and not an assignment
 *
 * Snapping the position to each arriving anchor would import the transport's
 * jitter into the picture: an anchor is 0-34 ms old when it is relayed, plus
 * whatever the IPC hop costs, and that varies message to message. At 24px per
 * beat, ±17 ms of jitter is a ±4px twitch of the whole note strip, ten times a
 * second -- clearly visible, and exactly the stutter this hook exists to avoid.
 *
 * So the clock free-runs at real time and is *pulled* toward the anchor by a
 * first-order filter (`CORRECTION_TAU_MS`): jitter is averaged away, a genuine
 * offset converges in about half a second, and anything larger than
 * `SNAP_BEATS` -- a seek, a new song, the first anchor of the night -- is
 * assigned outright rather than crawled to.
 *
 * ---------------------------------------------------------------------------
 * Cost
 *
 * One `requestAnimationFrame` callback in the audience renderer, doing about
 * ten floating-point operations and one MotionValue write. Nothing here touches
 * React state -- the beat position is a MotionValue, as on the host, so the lane
 * stack is never re-rendered to scroll it.
 */

/** Beats of error past which the clock is assigned rather than glided -- a seek, or the first anchor. */
const SNAP_BEATS = 8

/** Time constant of the correction filter. Roughly: 63% of an offset is taken up in this long. */
const CORRECTION_TAU_MS = 250

export interface AudienceStageClock {
  /** Per-frame beat position, for `NoteLane`'s scroll transform. Never enters React state. */
  beatPosition: MotionValue<number>
  /** The same clock, as a plain number, for anything that needs it at render time. */
  beatAt: (nowMs?: number) => number
}

/**
 * Where the song is *right now*, extrapolated from an anchor.
 *
 * Pure, and exported so the extrapolation can be asserted directly rather than
 * inferred from a rendered lane. A paused host clock does not extrapolate: its
 * reading is already the answer, and running it forward would have the audience
 * scroll on through a pause.
 */
export function playbackPositionMs(playback: AudiencePlayback, nowMs: number): number {
  if (playback.paused) return playback.positionMs
  // Clamped at zero: a `Date.now()` that has stepped backwards (an NTP
  // correction mid-song) must not make the song appear to run backwards.
  return playback.positionMs + Math.max(0, nowMs - playback.atEpochMs)
}

/** The same instant, as a chart beat. */
export function playbackBeat(playback: AudiencePlayback, meta: Pick<SongMeta, 'bpm' | 'gap'>, nowMs: number): number {
  return msToBeat(playbackPositionMs(playback, nowMs), meta.bpm, meta.gap)
}

export function useAudienceStageClock(
  playback: AudiencePlayback | null,
  meta: Pick<SongMeta, 'bpm' | 'gap'> | null,
): AudienceStageClock {
  const beatPosition = useMotionValue(0)

  // Written during render rather than in an effect: a fresh anchor must be in
  // hand for the very next animation frame, and an effect is a commit too late.
  // Neither is state, so neither causes a render.
  const playbackRef = useRef<AudiencePlayback | null>(playback)
  playbackRef.current = playback
  const metaRef = useRef<Pick<SongMeta, 'bpm' | 'gap'> | null>(meta)
  metaRef.current = meta

  const lastFrameAtRef = useRef(0)
  /** False until the first anchor has been assigned, so the lane starts *at* the song rather than gliding into it. */
  const anchoredRef = useRef(false)

  useAnimationFrame(() => {
    const anchor = playbackRef.current
    const songMeta = metaRef.current
    const now = Date.now()
    const previousFrameAt = lastFrameAtRef.current
    lastFrameAtRef.current = now

    if (!anchor || !songMeta || !Number.isFinite(songMeta.bpm) || songMeta.bpm <= 0) {
      anchoredRef.current = false
      return
    }

    const target = playbackBeat(anchor, songMeta, now)

    if (!anchoredRef.current) {
      anchoredRef.current = true
      beatPosition.set(target)
      return
    }

    const frameMs = previousFrameAt === 0 ? 0 : Math.max(0, now - previousFrameAt)
    // Free-run first, so a frame the anchor did not change for still advances
    // the song -- this is what makes the scroll smooth between messages.
    const freeRun = anchor.paused ? beatPosition.get() : beatPosition.get() + frameMs / msPerBeat(songMeta.bpm)
    const error = target - freeRun

    if (Math.abs(error) > SNAP_BEATS) {
      beatPosition.set(target)
      return
    }

    // Frame-rate independent, for the same reason the host's pitch smoothing is:
    // identical behaviour on a 60 Hz television and the 120 Hz panel this is
    // developed on, and a dropped frame corrects exactly as far as the two
    // frames it replaced.
    const gain = frameMs === 0 ? 0 : Math.min(1, frameMs / CORRECTION_TAU_MS)
    beatPosition.set(freeRun + error * gain)
  })

  return useMemo(
    () => ({
      beatPosition,
      beatAt: (nowMs = Date.now()) => {
        const anchor = playbackRef.current
        const songMeta = metaRef.current
        if (!anchor || !songMeta) return 0
        return playbackBeat(anchor, songMeta, nowMs)
      },
    }),
    [beatPosition],
  )
}
