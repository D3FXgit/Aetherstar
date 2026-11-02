import { useEffect, useMemo, useRef, useState } from 'react'
import {
  composeSongVolume,
  computeLoudnessGain,
  hasLoudnessMeasurement,
  MAX_ELEMENT_GAIN,
  MAX_NORMALISATION_GAIN,
  type SongLoudness,
} from './loudness'
import { useMixerGain } from './mixer'
import { analyseSongLoudness, loadSongLoudness, peekSongLoudness, subscribeSongLoudness, UNKNOWN_LOUDNESS } from './songGain'

/** How long a measurement that lands after the level was already settled takes to fade in. Long enough that nobody hears a step. */
export const LATE_MEASUREMENT_RAMP_MS = 1500

export interface SongGainOptions {
  /** Which mixer channel this element belongs to: the song itself, or its separated guide vocal. */
  channel?: 'music' | 'guideVocals'
  /** Ceiling on the final value. 1 for an `<audio>` element (the default). */
  maxGain?: number
  /**
   * A URL for the song's audio, used to measure it in the background when it
   * has no measurement yet. Optional: without one, the index's mix path is
   * used.
   */
  mediaUrl?: string | null
}

/**
 * The volume to give one song's `<audio>` element: loudness normalisation,
 * then the user's mixer setting, capped at the element's 1.0.
 *
 * - Opens at whatever is already known for the song (usually everything, on
 *   any second visit), else at the conservative unmeasured default -- never at
 *   silence and never at full blast.
 * - When the song has never been measured, measures it in the background and
 *   remembers the result for every later play.
 * - A measurement that arrives after the level has settled is faded in over
 *   LATE_MEASUREMENT_RAMP_MS rather than applied as a step, so a song already
 *   playing never jumps. Mixer changes apply at once: those are the user
 *   turning a knob, and should feel like it.
 *
 * @param songFolder the song's folder, which is its primary key in the index
 * @param chartVolume `#VOLUME` from the chart, when its author declared one
 */
export function useSongGain(
  songFolder: string | null | undefined,
  chartVolume?: number | null,
  options: SongGainOptions = {},
): number {
  const { channel = 'music', maxGain = MAX_ELEMENT_GAIN, mediaUrl = null } = options
  const [loudness, setLoudness] = useState<SongLoudness>(() => peekSongLoudness(songFolder) ?? UNKNOWN_LOUDNESS)
  /** True once the first answer for this song is in -- from then on, changes are faded rather than stepped. */
  const settledRef = useRef(false)
  const [rampMs, setRampMs] = useState(0)
  const mixerGain = useMixerGain(channel)

  useEffect(() => {
    let cancelled = false
    const initial = peekSongLoudness(songFolder)
    settledRef.current = initial !== null
    setRampMs(0)
    setLoudness(initial ?? UNKNOWN_LOUDNESS)
    if (!songFolder) return

    const apply = (next: SongLoudness) => {
      // A song change while this was in flight: the answer belongs to the
      // previous song.
      if (cancelled) return
      setRampMs(settledRef.current ? LATE_MEASUREMENT_RAMP_MS : 0)
      settledRef.current = true
      setLoudness(next)
    }

    const unsubscribe = subscribeSongLoudness(songFolder, apply)
    void loadSongLoudness(songFolder).then((resolved) => {
      if (cancelled) return
      apply(resolved)
      if (!hasLoudnessMeasurement(resolved)) {
        void analyseSongLoudness(songFolder, { mediaUrl }).then((measured) => {
          if (measured) apply(measured)
        })
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [songFolder, mediaUrl])

  const normalisation = useMemo(
    () => computeLoudnessGain({ ...loudness, chartVolume, maxGain: MAX_NORMALISATION_GAIN }),
    [loudness, chartVolume],
  )
  const smoothed = useRampedValue(normalisation, rampMs)
  return composeSongVolume(smoothed, mixerGain, maxGain)
}

/**
 * `target`, but approached over `rampMs` (linear in dB) instead of jumping.
 * A ramp of 0 jumps.
 */
function useRampedValue(target: number, rampMs: number): number {
  const [value, setValue] = useState(target)
  const valueRef = useRef(target)

  useEffect(() => {
    const from = valueRef.current
    if (from === target) return
    if (rampMs <= 0 || from <= 0 || target <= 0) {
      valueRef.current = target
      setValue(target)
      return
    }

    const fromDb = Math.log10(from)
    const toDb = Math.log10(target)
    const started = now()
    let handle: number | ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const step = () => {
      if (stopped) return
      const t = Math.min(1, (now() - started) / rampMs)
      const next = 10 ** (fromDb + (toDb - fromDb) * t)
      valueRef.current = next
      setValue(next)
      if (t < 1) handle = schedule(step)
    }
    handle = schedule(step)
    return () => {
      stopped = true
      cancel(handle)
    }
  }, [target, rampMs])

  return value
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** About 30 updates a second: smooth for a volume fade, and a tenth of the work of every frame. */
function schedule(callback: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 33)
}

function cancel(handle: number | ReturnType<typeof setTimeout> | null): void {
  if (handle !== null) clearTimeout(handle as ReturnType<typeof setTimeout>)
}