import type { SongLine } from '../../contracts/types'

export interface PitchRangeScale {
  min: number
  max: number
  toY(pitch: number, laneHeightPx: number): number
}

/**
 * Auto-fits the note lane's vertical range to this song's actual min/max
 * pitch, computed once per chart -- every song fills the
 * lane's visible height regardless of its absolute pitch range.
 */
export function computePitchRangeScale(lines: SongLine[]): PitchRangeScale {
  const pitches = lines.flatMap((line) => line.notes.map((note) => note.pitch))
  return computePitchRangeScaleFromPitches(pitches)
}

/** Same auto-fit logic as `computePitchRangeScale`, given an already-flattened pitch list (e.g. `NoteWithId[]`). */
export function computePitchRangeScaleFromPitches(pitches: number[]): PitchRangeScale {
  let min = Infinity
  let max = -Infinity

  for (const pitch of pitches) {
    if (pitch < min) min = pitch
    if (pitch > max) max = pitch
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 0
  }

  const range = max - min

  return {
    min,
    max,
    toY(pitch, laneHeightPx) {
      if (range === 0) return laneHeightPx / 2
      const fraction = (pitch - min) / range
      return laneHeightPx * (1 - fraction)
    },
  }
}
