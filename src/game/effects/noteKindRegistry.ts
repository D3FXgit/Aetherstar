import type { NoteWithId } from '../types'

/**
 * Which note ids belong to golden notes, for the one consumer that has the id
 * but not the note.
 *
 * `HitEvent` carries a `noteId` and a tier and nothing else, and the burst
 * layer (LaneHitFx) is a *sibling* of the note lane -- it is handed a
 * `resolveNoteY` callback by Gameplay and no other view of the chart. So
 * "was the note I just cleared a golden one" had three possible answers:
 *
 *  1. Widen `HitEvent`. That is `src/game/state/**`, owned elsewhere, and it
 *     would put a rendering concern into the judging contract.
 *  2. Look the note element up in the DOM on every judged note. A
 *     `querySelector` per hit per lane, over a subtree of a few hundred nodes,
 *     on the one screen that cannot afford incidental DOM work.
 *  3. This: a lookup table of chart-derived *constants*.
 *
 * It is deliberately not a store. Nothing here changes while a song is
 * playing, nobody re-renders when it does change, and a note's kind is a
 * property of the chart file -- the same for every singer, which is why one
 * table keyed by note id serves all eight lanes rather than one per player.
 *
 * Registrations are ref-counted per id so that eight lanes sharing one chart
 * (MultiplayerGameplay) can each register and unregister independently, and so
 * that the last lane to leave a song genuinely empties the table instead of
 * leaving the next song's ids shadowed by the previous one's.
 */

interface Entry {
  golden: boolean
  refs: number
}

const entries = new Map<string, Entry>()

/** Golden and golden-rap notes are both worth double, and both celebrate (and are drawn) as golden. */
export function isGoldenKind(kind: NoteWithId['kind']): boolean {
  return kind === 'golden' || kind === 'goldenRap'
}

function isGolden(note: NoteWithId): boolean {
  return isGoldenKind(note.kind)
}

/**
 * Records these notes' kinds and returns the matching release.
 *
 * Call it from an effect keyed on the chart; the returned function is the
 * effect's cleanup.
 */
export function registerNoteKinds(notes: readonly NoteWithId[]): () => void {
  const ids: string[] = []

  for (const note of notes) {
    const existing = entries.get(note.noteId)
    if (existing) {
      existing.refs += 1
      // Last registration wins on the value itself: a second chart reusing an
      // id while the first is still mounted is a bug, but the *current* chart
      // is always the more useful answer.
      existing.golden = isGolden(note)
    } else {
      entries.set(note.noteId, { golden: isGolden(note), refs: 1 })
    }
    ids.push(note.noteId)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    for (const id of ids) {
      const entry = entries.get(id)
      if (!entry) continue
      entry.refs -= 1
      if (entry.refs <= 0) entries.delete(id)
    }
  }
}

/** False for an unknown id -- a burst with no note behind it is still a burst, just not a golden one. */
export function isGoldenNote(noteId: string): boolean {
  return entries.get(noteId)?.golden ?? false
}

/** Test-only escape hatch: drops every registration, whatever its ref count. */
export function resetNoteKinds(): void {
  entries.clear()
}
