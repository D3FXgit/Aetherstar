import { createContext, useContext } from 'react'
import type { MotionValue } from 'framer-motion'

/**
 * What the Stage shares with the layers drawn over it.
 *
 * The instrumental fade is computed **once**, by Stage, and every layer that
 * should fade with the lyric box reads this same MotionValue -- rather than
 * each layer deriving its own copy from the chart and hoping the two stay in
 * step.
 */
export interface StageClockContextValue {
  /** Per-frame beat position (the same MotionValue the overlay is handed). */
  beatPosition: MotionValue<number>
  /** 0 during an instrumental break, 1 otherwise, faded -- see useInstrumentalFade. */
  instrumentalOpacity: MotionValue<number>
  /** The beat *right now*, read synchronously from the clock element rather than from the last frame's value. */
  getBeat(): number
}

export const StageClockContext = createContext<StageClockContextValue | null>(null)

/** The surrounding Stage's clock, or null outside one (labs, tests). */
export function useStageClockContext(): StageClockContextValue | null {
  return useContext(StageClockContext)
}
