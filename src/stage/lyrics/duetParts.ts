import type { SongLine, SongPart } from '../../contracts/types'

/**
 * Which lines belong to which singer in a duet -- the one place this is
 * decided, shared by the lyric boxes, the host's note lanes and the audience
 * window's mirror of them.
 *
 * Note ids are assigned by `flattenNotes` in array order, so every consumer
 * that has to agree on "note-12" must also agree on the *order* of the lines it
 * flattened. Everything here therefore returns lines sorted by when they start,
 * and is deterministic: the same chart always yields the same arrays.
 */

/** The beat a line starts on: its first note, else its break marker, else never. */
export function lineStartBeat(line: SongLine): number {
  let start = Infinity
  for (const note of line.notes) {
    if (note.startBeat < start) start = note.startBeat
  }
  if (Number.isFinite(start)) return start
  return line.lineBreakBeat ?? Infinity
}

/**
 * Lines in the order they are sung. Stable (equal starts keep file order) and
 * returns the input array itself when it is already in order, so an ordinary
 * chart keeps its identity -- and with it every memo keyed on it.
 */
export function sortLinesByStart(lines: SongLine[]): SongLine[] {
  for (let index = 1; index < lines.length; index += 1) {
    if (lineStartBeat(lines[index]) < lineStartBeat(lines[index - 1])) {
      return lines
        .map((line, order) => ({ line, order, start: lineStartBeat(line) }))
        .sort((a, b) => a.start - b.start || a.order - b.order)
        .map((entry) => entry.line)
    }
  }
  return lines
}

/** A duet has lines for both singers; a chart with only one named part is sung as a whole. */
export function isDuetChart(lines: SongLine[]): boolean {
  let p1 = false
  let p2 = false
  for (const line of lines) {
    if (line.part === 'p1') p1 = true
    else if (line.part === 'p2') p2 = true
    if (p1 && p2) return true
  }
  return false
}

/** One duet singer's lines: their own part plus the shared (`solo` / P3) lines, in singing order. */
export function linesForPart(lines: SongLine[], part: 'p1' | 'p2'): SongLine[] {
  return sortLinesByStart(lines.filter((line) => line.part === part || line.part === 'solo'))
}

export interface LyricTrack {
  /** `solo` for an ordinary chart; `p1` / `p2` for a duet's two boxes. */
  part: SongPart
  lines: SongLine[]
}

/**
 * The lyric boxes a chart needs, top to bottom: one for an ordinary song; two
 * for a duet -- P2 above, P1 below, the classic party-karaoke layout, each carrying its own
 * singer's lines plus the shared ones.
 */
export function lyricTracks(lines: SongLine[]): LyricTrack[] {
  if (!isDuetChart(lines)) return [{ part: 'solo', lines: sortLinesByStart(lines) }]
  return [
    { part: 'p2', lines: linesForPart(lines, 'p2') },
    { part: 'p1', lines: linesForPart(lines, 'p1') },
  ]
}
