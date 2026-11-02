import type { SongChart } from '../../contracts/types'
import { beatToMs } from '../timing/beatMs'

/** The lead-in countdown is shown only for this long before the first note. */
export const COUNTDOWN_LEAD_IN_MS = 3000

/** Whole seconds remaining before `targetMs`, never negative. */
export function secondsUntilGap(currentMs: number, gapMs: number): number {
  return Math.max(0, Math.ceil((gapMs - currentMs) / 1000))
}

/**
 * When the chart's first note is sung, in ms of audio -- what the lead-in
 * counts down to. `#GAP` is beat 0, which is often seconds before anyone
 * sings; it is only the answer for a chart with no notes at all.
 */
export function firstNoteMs(chart: Pick<SongChart, 'meta' | 'lines'>): number {
  let first = Infinity
  for (const line of chart.lines) {
    for (const note of line.notes) if (note.startBeat < first) first = note.startBeat
  }
  return Number.isFinite(first) ? beatToMs(first, chart.meta.bpm, chart.meta.gap) : chart.meta.gap
}

/** The number to show at `currentMs`: 3, 2, 1 inside the last COUNTDOWN_LEAD_IN_MS before `targetMs`, else null. */
export function countdownSecondsAt(currentMs: number, targetMs: number): number | null {
  const remaining = targetMs - currentMs
  if (remaining <= 0 || remaining > COUNTDOWN_LEAD_IN_MS) return null
  return secondsUntilGap(currentMs, targetMs)
}
