import type { SongLine } from '../../contracts/types'
import type { NoteWithId } from '../types'

/** Flattens every line's notes in chart order, assigning each a stable, deterministic id. */
export function flattenNotes(lines: SongLine[]): NoteWithId[] {
  const flat: NoteWithId[] = []
  let index = 0

  for (const line of lines) {
    for (const note of line.notes) {
      flat.push({ ...note, noteId: `note-${index}` })
      index++
    }
  }

  return flat
}
