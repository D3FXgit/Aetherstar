import { useMemo, useRef } from 'react'
import { animate, useAnimationFrame, useMotionValue, useReducedMotion, type MotionValue } from 'framer-motion'
import type { SongLine } from '../contracts/types'
import {
  findInstrumentalBreaks,
  INSTRUMENTAL_FADE_MS,
  isPitchUiVisibleAtBeat,
} from './instrumentalBreaks'

/**
 * An opacity that goes to 0 for the length of an instrumental break and comes
 * back 2.5 seconds before the next vocal line.
 *
 * ## Why a MotionValue and not state
 *
 * The check runs on every frame, so a `useState` here would re-render the whole
 * singer view sixty to a hundred and twenty times a second -- the exact thing
 * every other part of this screen is built to avoid. A MotionValue is written
 * straight to the element's inline style by framer-motion and never touches
 * React at all, and `opacity` is compositor-only, so a fading field costs no
 * layout and no paint.
 *
 * The per-frame cost is one `beat.get()` and a short scan (see
 * `isPitchUiVisibleAtBeat`); the *animation* only starts on the handful of
 * frames per song where the answer actually changes.
 *
 * Call this **once per layer**, not once per lane, and share the returned value
 * with every element in that layer that should fade together. Both layers of
 * the singer view derive their breaks from the same chart and the same clock,
 * so Stage's lyric bars and the overlay's pitch fields fade in lockstep without
 * either being able to see the other.
 *
 * ## Reduced motion
 *
 * The interface still hides and still comes back -- that behaviour is
 * functional, not decorative, and removing it would leave the video blocked for
 * exactly the people who asked for less on screen. Only the *fade* goes: the
 * duration collapses to zero and the change is a cut.
 */
export function useInstrumentalFade(
  lines: SongLine[],
  bpm: number,
  beat: MotionValue<number>,
): MotionValue<number> {
  const reduceMotion = useReducedMotion() ?? false
  const opacity = useMotionValue(1)
  const visibleRef = useRef(true)

  const breaks = useMemo(() => findInstrumentalBreaks(lines, bpm), [lines, bpm])

  useAnimationFrame(() => {
    // A chart with no instrumental stretch in it -- most short ones -- pays a
    // single length check per frame and nothing else, forever.
    if (breaks.length === 0) return

    const visible = isPitchUiVisibleAtBeat(beat.get(), breaks)
    if (visible === visibleRef.current) return
    visibleRef.current = visible

    animate(opacity, visible ? 1 : 0, {
      duration: reduceMotion ? 0 : INSTRUMENTAL_FADE_MS / 1000,
      ease: 'easeInOut',
    })
  })

  return opacity
}
