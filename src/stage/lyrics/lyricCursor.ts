import { useEffect, useState } from 'react'
import { useMotionValue, type MotionValue } from 'framer-motion'
import type { SongLine } from '../../contracts/types'
import { findLineIndexForBeat } from '../timing/findLineIndexForBeat'
import { syllableProgressAt } from './syllableProgressAt'

export interface LyricCursor {
  lineIndex: number
  syllableIndex: number
}

/** Which line is up and which of its syllables has started, at `beat`. */
export function lyricCursorAt(lines: SongLine[], beat: number): LyricCursor {
  const lineIndex = findLineIndexForBeat(lines, beat)
  const notes = lines[lineIndex]?.notes ?? []
  let syllableIndex = -1
  for (let index = 0; index < notes.length; index += 1) {
    if (notes[index].startBeat <= beat) syllableIndex = index
  }
  return { lineIndex, syllableIndex }
}

/**
 * Line, syllable and sweep progress for one lyric box, straight off a clock.
 *
 * The cursor is React state that changes only at line and syllable
 * boundaries; the sweep within a syllable is a MotionValue and never renders.
 */
export function useLyricCursor(lines: SongLine[], beatPosition: MotionValue<number>) {
  const [cursor, setCursor] = useState<LyricCursor>(() => lyricCursorAt(lines, beatPosition.get()))
  const progress = useMotionValue(0)

  useEffect(() => {
    const update = (beat: number) => {
      const next = lyricCursorAt(lines, beat)
      setCursor((previous) =>
        previous.lineIndex === next.lineIndex && previous.syllableIndex === next.syllableIndex ? previous : next,
      )
      const note = next.syllableIndex >= 0 ? lines[next.lineIndex]?.notes[next.syllableIndex] : undefined
      progress.set(note ? syllableProgressAt(note, beat) : 0)
    }
    update(beatPosition.get())
    return beatPosition.on('change', update)
  }, [lines, beatPosition, progress])

  return { ...cursor, progress }
}
