import type { SongNote } from '../../contracts/types'

/** 0..1 sweep progress of a syllable's highlight across its beat range, clamped. */
export function syllableProgressAt(note: SongNote, currentBeat: number): number {
  if (note.length <= 0) return currentBeat >= note.startBeat ? 1 : 0
  const progress = (currentBeat - note.startBeat) / note.length
  return Math.min(1, Math.max(0, progress))
}
