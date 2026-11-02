import type { SongLine } from '../contracts/types'
import { msPerBeat } from '../stage/timing/beatMs'

/**
 * When the singer view gets out of the way of the song's video.
 *
 * A karaoke chart is mostly vocal lines with short rests between them, but
 * every real song has a handful of genuine instrumental stretches -- an intro
 * fill, a middle eight, a guitar solo -- where the screen is showing an empty
 * pitch field and two bars of stale lyrics over the one part of the video
 * anybody actually wants to look at. This finds those stretches **from the
 * chart**, so the timing is exact and known before a note is played, rather
 * than inferred at runtime from "nothing has happened for a while".
 *
 * Everything here is in **beats**, not milliseconds, and that is deliberate:
 * the clock the singer view runs on is a beat position, so working in beats
 * means the per-frame check is a bare comparison with no conversion, and the
 * result cannot drift from the chart if `#GAP` is adjusted (which it is -- see
 * Sing's output-latency offset).
 *
 * The thresholds are the only things expressed in time, because they are about
 * human perception rather than about the music.
 */

/** A silence longer than this is an instrumental break rather than a breath. */
export const INSTRUMENTAL_GAP_MS = 5000

/** How far ahead of the next line the interface comes back, so the singer is ready for it. */
export const RETURN_LEAD_MS = 2500

/**
 * How long the fade itself takes.
 *
 * Short relative to the 2.5s lead, so the interface is fully back well before
 * the singer needs to read it; long enough to read as the screen deliberately
 * clearing rather than as a rendering glitch.
 */
export const INSTRUMENTAL_FADE_MS = 450

export interface InstrumentalBreak {
  /** Beat at which the interface starts fading out -- the last note of the preceding line ends here. */
  hideAtBeat: number
  /** Beat at which it starts coming back, RETURN_LEAD_MS before the next line's first note. */
  showAtBeat: number
}

/** A line's first and last beat, or null for a line that carries no notes at all. */
function lineSpan(line: SongLine): { start: number; end: number } | null {
  if (line.notes.length === 0) return null
  let start = Infinity
  let end = -Infinity
  for (const note of line.notes) {
    if (note.startBeat < start) start = note.startBeat
    const noteEnd = note.startBeat + note.length
    if (noteEnd > end) end = noteEnd
  }
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

/**
 * Every instrumental break in a chart.
 *
 * The gap measured is **the end of one vocal line to the start of the next**,
 * which is the only definition that survives real charts: UltraStar line breaks
 * (`-` rows) are a display hint and do not reliably mark a musical rest, and
 * note-to-note gaps inside a line are legato artefacts, not silences.
 *
 * The lead-in *before the first line* is deliberately not a break. That period
 * already has an owner -- the pre-`#GAP` countdown, which is showing the singer
 * a "3, 2, 1" over the same video -- and two systems fading the same interface
 * in opposite directions is worse than either.
 *
 * Lines are sorted by their own first beat rather than trusted in file order:
 * a duet chart interleaves p1 and p2 lines, and in a few real files not
 * strictly in time order.
 */
export function findInstrumentalBreaks(lines: SongLine[], bpm: number): InstrumentalBreak[] {
  const perBeat = msPerBeat(bpm)
  if (!(perBeat > 0) || !Number.isFinite(perBeat)) return []

  const gapBeats = INSTRUMENTAL_GAP_MS / perBeat
  const leadBeats = RETURN_LEAD_MS / perBeat

  const spans = lines
    .map(lineSpan)
    .filter((span): span is { start: number; end: number } => span !== null)
    .sort((a, b) => a.start - b.start)

  const breaks: InstrumentalBreak[] = []
  // A running maximum over what has been seen so far, not just the previous
  // line: in a duet the p1 and p2 lines overlap, so the previous line in
  // *start* order can easily end before one already passed. The break only
  // begins once every line so far has finished. Kept incrementally -- a
  // `Math.max(...slice)` per line was O(n^2) and spread a whole chart's worth
  // of arguments onto the stack.
  let end = -Infinity
  for (let index = 0; index < spans.length - 1; index += 1) {
    if (spans[index].end > end) end = spans[index].end
    const next = spans[index + 1].start
    if (next - end > gapBeats) {
      breaks.push({ hideAtBeat: end, showAtBeat: next - leadBeats })
    }
  }

  return breaks
}

/**
 * Is the pitch interface meant to be on screen at this beat?
 *
 * A linear scan. Charts produce single-figure numbers of breaks, this is called
 * once per layer per frame (not once per lane), and an index cursor would have
 * to be invalidated on every seek -- so the scan is both cheaper in practice
 * and the only version that is correct when the clock jumps.
 */
export function isPitchUiVisibleAtBeat(beat: number, breaks: InstrumentalBreak[]): boolean {
  for (const gap of breaks) {
    if (beat >= gap.hideAtBeat && beat < gap.showAtBeat) return false
  }
  return true
}
