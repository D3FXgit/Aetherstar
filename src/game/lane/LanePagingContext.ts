import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMotionValue, useTransform, type MotionValue } from 'framer-motion'
import type { SongLine } from '../../contracts/types'
import {
  buildLinePaging,
  noteLayoutOnPage,
  pageIndexAt,
  pageXPercent,
  playheadPercentAt,
  scaleForWindow,
  type LinePaging,
} from './linePaging'
import type { PitchRangeScale } from './pitchRangeScale'

/**
 * One lane's paging, shared by every layer drawn inside it -- the note strip,
 * the playhead, the pitch rule, the sustain spark and the hit bursts -- so they
 * all agree on which line is up and where "now" is across it.
 *
 * Absent (labs, unit tests, static previews), every layer falls back to the
 * original scrolling lane.
 */
export interface LanePagingValue {
  paging: LinePaging
  beatPosition: MotionValue<number>
  /** The playhead across the lane, 0..100 (percent of the lane's width). A MotionValue: moving it never renders React. */
  playheadPercent: MotionValue<number>
  /** The same, as a `translateX` for a full-width layer -- a percentage of its own width is a percentage of the lane's. */
  playheadX: MotionValue<string>
  /** A pitch scale whose `toY` follows whichever page is up right now. */
  liveScale: PitchRangeScale
  pageIndexAt(beat: number): number
  /** Where a note sits on its own page: x (percent) at its start and end, and its page's scale. Null for an unknown id. */
  notePlacement(noteId: string): { startPercent: number; endPercent: number; scale: PitchRangeScale } | null
}

export const LanePagingContext = createContext<LanePagingValue | null>(null)

export function useLanePaging(): LanePagingValue | null {
  return useContext(LanePagingContext)
}

const EMPTY_SCALE = scaleForWindow({ min: 0, max: 12 })

/** Builds a lane's paging value. Memoised on the lines and the clock, so a page flip never rebuilds it. */
export function useLanePagingValue(lines: SongLine[], bpm: number, beatPosition: MotionValue<number>): LanePagingValue {
  const paging = useMemo(() => buildLinePaging(lines, bpm), [lines, bpm])
  // Subscribed rather than `useTransform(beatPosition, ...)`: the transform's
  // closure would keep the first chart's paging after a chart change.
  const playheadPercent = useMotionValue(playheadPercentAt(paging, beatPosition.get()))
  useEffect(() => {
    const update = (beat: number) => playheadPercent.set(playheadPercentAt(paging, beat))
    update(beatPosition.get())
    return beatPosition.on('change', update)
  }, [paging, beatPosition, playheadPercent])
  const playheadX = useTransform(playheadPercent, (percent) => `${percent}%`)

  return useMemo(() => {
    const currentScale = (): PitchRangeScale => {
      const index = pageIndexAt(paging, beatPosition.get())
      return index >= 0 ? paging.pages[index].scale : EMPTY_SCALE
    }
    const liveScale: PitchRangeScale = {
      get min() {
        return currentScale().min
      },
      get max() {
        return currentScale().max
      },
      toY(pitch, laneHeightPx) {
        return currentScale().toY(pitch, laneHeightPx)
      },
    }
    const noteById = new Map<string, { startBeat: number; length: number }>()
    for (const page of paging.pages) for (const note of page.notes) noteById.set(note.noteId, note)

    return {
      paging,
      beatPosition,
      playheadPercent,
      playheadX,
      liveScale,
      pageIndexAt: (beat: number) => pageIndexAt(paging, beat),
      notePlacement(noteId: string) {
        const pageIndex = paging.pageOfNote.get(noteId)
        const note = noteById.get(noteId)
        if (pageIndex === undefined || !note) return null
        const page = paging.pages[pageIndex]
        const layout = noteLayoutOnPage(page, note)
        return {
          startPercent: layout.leftPercent,
          endPercent: pageXPercent(page, note.startBeat + note.length),
          scale: page.scale,
        }
      },
    }
  }, [paging, beatPosition, playheadPercent, playheadX])
}

/** Provides a lane's paging to everything drawn inside it. */
export function LanePagingProvider({
  lines,
  bpm,
  beatPosition,
  children,
}: {
  lines: SongLine[]
  bpm: number
  beatPosition: MotionValue<number>
  children: ReactNode
}) {
  const value = useLanePagingValue(lines, bpm, beatPosition)
  return createElement(LanePagingContext.Provider, { value }, children)
}

/**
 * The page on screen, as React state that changes **only when the page flips**
 * -- the clock moves every frame, the page a few times a minute. -1 when there
 * is no paging (or no pages).
 */
export function useLanePageIndex(value: LanePagingValue | null): number {
  const [index, setIndex] = useState(() => (value ? value.pageIndexAt(value.beatPosition.get()) : -1))

  useEffect(() => {
    if (!value) {
      setIndex(-1)
      return
    }
    const update = (beat: number) => setIndex(value.pageIndexAt(beat))
    update(value.beatPosition.get())
    return value.beatPosition.on('change', update)
  }, [value])

  return index
}
