import type { SongLine } from '../../contracts/types'
import type { NoteWithId } from '../types'
import { flattenNotes } from '../matching/flattenNotes'
import { msPerBeat } from '../../stage/timing/beatMs'
import type { PitchRangeScale } from './pitchRangeScale'

/**
 * Party-karaoke-style line paging: the lane shows **one line at a time**, laid out
 * across its whole width, and a playhead sweeps left to right over it. When the
 * line is done the page flips to the next one.
 *
 * Everything here is pure and computed once per lane per chart. The per-frame
 * question -- "which page is up at this beat?" -- is a binary search
 * (`pageIndexAt`), and the only React work a page costs is one render of the
 * lane when it flips.
 */

/** How long before the next line's first note its page appears, when nothing else says when to flip. */
export const PAGE_FLIP_LEAD_MS = 450

/** A page's pitch window is never narrower than an octave, so a monotone line is not drawn as a staircase. */
export const PAGE_MIN_RANGE_SEMITONES = 12

/** Room left above the highest and below the lowest note of a line. */
export const PAGE_PITCH_PADDING_SEMITONES = 1

/** The first note starts this far in from the lane's left edge, and the last ends this far from its right. */
export const PAGE_EDGE_PADDING_PERCENT = 4

export interface PitchWindow {
  min: number
  max: number
}

export interface LinePage {
  index: number
  /** Beat this page comes up (the previous page's flip); -Infinity for the first page. */
  fromBeat: number
  /** Beat it is replaced by the next page; Infinity for the last. */
  untilBeat: number
  /** The beats laid across the page's width: the line's first note start to its last note end. */
  startBeat: number
  endBeat: number
  /** The line's notes, with the same ids `flattenNotes(lines)` gives them. */
  notes: NoteWithId[]
  window: PitchWindow
  /** Pitch -> Y for this page (top edge of a note, as every PitchRangeScale). */
  scale: PitchRangeScale
}

export interface LinePaging {
  pages: LinePage[]
  /** Note id -> index of the page it is drawn on. */
  pageOfNote: Map<string, number>
}

export function scaleForWindow(window: PitchWindow): PitchRangeScale {
  const range = window.max - window.min
  return {
    min: window.min,
    max: window.max,
    toY(pitch, laneHeightPx) {
      if (!(range > 0)) return laneHeightPx / 2
      return laneHeightPx * (1 - (pitch - window.min) / range)
    },
  }
}

/**
 * The pitch window for a line: its notes plus a semitone of padding, widened
 * symmetrically to at least an octave -- and the previous page's window kept
 * whenever this line fits inside it, so consecutive lines in the same register
 * do not make every note jump.
 */
export function pitchWindowFor(pitches: number[], previous: PitchWindow | null): PitchWindow {
  if (pitches.length === 0) return previous ?? { min: 0, max: PAGE_MIN_RANGE_SEMITONES }
  let lo = Infinity
  let hi = -Infinity
  for (const pitch of pitches) {
    if (pitch < lo) lo = pitch
    if (pitch > hi) hi = pitch
  }
  lo -= PAGE_PITCH_PADDING_SEMITONES
  hi += PAGE_PITCH_PADDING_SEMITONES
  if (previous && lo >= previous.min && hi <= previous.max) return previous
  if (hi - lo < PAGE_MIN_RANGE_SEMITONES) {
    const centre = (lo + hi) / 2
    lo = centre - PAGE_MIN_RANGE_SEMITONES / 2
    hi = centre + PAGE_MIN_RANGE_SEMITONES / 2
  }
  return { min: lo, max: hi }
}

/**
 * Builds the pages for one lane's lines.
 *
 * A page flips at `max(lastNoteEnd, min(lineBreakBeat, nextStart - lead))`, and
 * never after the next line's first note: the line is never taken away while it
 * is still being sung, the chart's own break marker is honoured, and the next
 * line is always up a moment before it has to be sung.
 */
export function buildLinePaging(lines: SongLine[], bpm: number): LinePaging {
  const flat = flattenNotes(lines)
  const leadBeats = bpm > 0 && Number.isFinite(bpm) ? PAGE_FLIP_LEAD_MS / msPerBeat(bpm) : 0

  // Re-attach the ids flattenNotes assigned, line by line (same walk order).
  const drafts: { notes: NoteWithId[]; startBeat: number; endBeat: number; lineBreakBeat?: number; order: number }[] = []
  let cursor = 0
  lines.forEach((line, order) => {
    const notes = flat.slice(cursor, cursor + line.notes.length)
    cursor += line.notes.length
    if (notes.length === 0) return
    let startBeat = Infinity
    let endBeat = -Infinity
    for (const note of notes) {
      if (note.startBeat < startBeat) startBeat = note.startBeat
      const end = note.startBeat + note.length
      if (end > endBeat) endBeat = end
    }
    drafts.push({ notes, startBeat, endBeat, lineBreakBeat: line.lineBreakBeat, order })
  })
  drafts.sort((a, b) => a.startBeat - b.startBeat || a.order - b.order)

  const pages: LinePage[] = []
  const pageOfNote = new Map<string, number>()
  let previousWindow: PitchWindow | null = null
  let fromBeat = -Infinity

  drafts.forEach((draft, index) => {
    const next = drafts[index + 1]
    let untilBeat = Infinity
    if (next) {
      const breakBeat = draft.lineBreakBeat !== undefined && Number.isFinite(draft.lineBreakBeat) ? draft.lineBreakBeat : Infinity
      const flip = Math.max(draft.endBeat, Math.min(breakBeat, next.startBeat - leadBeats))
      untilBeat = Math.max(fromBeat, Math.min(flip, next.startBeat))
    }
    const window = pitchWindowFor(
      draft.notes.map((note) => note.pitch),
      previousWindow,
    )
    previousWindow = window
    const page: LinePage = {
      index,
      fromBeat,
      untilBeat,
      startBeat: draft.startBeat,
      endBeat: draft.endBeat,
      notes: draft.notes,
      window,
      scale: scaleForWindow(window),
    }
    for (const note of draft.notes) pageOfNote.set(note.noteId, index)
    pages.push(page)
    fromBeat = untilBeat
  })

  return { pages, pageOfNote }
}

/** The page on screen at `beat`: the first whose `untilBeat` is still ahead. Binary search; -1 for a lane with no pages. */
export function pageIndexAt(paging: LinePaging, beat: number): number {
  const { pages } = paging
  if (pages.length === 0) return -1
  let lo = 0
  let hi = pages.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beat < pages[mid].untilBeat) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Where `beat` falls across a page, as a percentage of the lane's width (unclamped). */
export function pageXPercent(page: LinePage, beat: number): number {
  const span = page.endBeat - page.startBeat
  const usable = 100 - 2 * PAGE_EDGE_PADDING_PERCENT
  if (!(span > 0)) return PAGE_EDGE_PADDING_PERCENT
  return PAGE_EDGE_PADDING_PERCENT + ((beat - page.startBeat) / span) * usable
}

/** A note's box on its page, in percent of the lane's width. */
export function noteLayoutOnPage(page: LinePage, note: { startBeat: number; length: number }): { leftPercent: number; widthPercent: number } {
  const left = pageXPercent(page, note.startBeat)
  const right = pageXPercent(page, note.startBeat + note.length)
  return { leftPercent: left, widthPercent: Math.max(0, right - left) }
}

/** The playhead's position at `beat`, clamped to the lane. */
export function playheadPercentAt(paging: LinePaging, beat: number): number {
  const index = pageIndexAt(paging, beat)
  if (index < 0) return 0
  const x = pageXPercent(paging.pages[index], beat)
  return Math.min(100, Math.max(0, x))
}
