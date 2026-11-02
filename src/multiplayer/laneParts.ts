import type { SongLine } from '../contracts/types'
import { isDuetChart, linesForPart, sortLinesByStart } from '../stage/lyrics/duetParts'

/**
 * Which lines a singer's lane is given -- shared by `MultiplayerGameplay` (which
 * scores them) and the audience window (which mirrors them), because a
 * broadcast judgement names its note by an id that only means anything inside
 * one lane's flattened chart. Both sides calling this one function is what
 * keeps "note-12" the same note on both screens.
 *
 * - **An ordinary song**: every lane sings the whole chart.
 * - **A duet**: lanes alternate P1, P2, P1, P2... (each with the shared lines),
 *   so a third and fourth singer join a part instead of getting an empty lane.
 *
 * The no-hardware fallback (one lane, nothing configured) is simply lane 0,
 * which sings P1 in a duet.
 *
 * Each singer's score is measured against exactly these lines (Gameplay builds
 * its scoring plan from the lines it is handed), so a perfect run of either
 * part reaches the same maximum.
 */
export function partForLaneIndex(index: number): 'p1' | 'p2' {
  return index % 2 === 0 ? 'p1' : 'p2'
}

interface LaneLinesCache {
  whole?: SongLine[]
  p1?: SongLine[]
  p2?: SongLine[]
}

/** Per chart, so every lane, every render and every window get the *same* arrays (and the memos keyed on them hold). */
const cache = new WeakMap<SongLine[], LaneLinesCache>()

export function linesForLane(lines: SongLine[], laneIndex: number): SongLine[] {
  let entry = cache.get(lines)
  if (!entry) {
    entry = {}
    cache.set(lines, entry)
  }
  if (!isDuetChart(lines)) {
    const whole = entry.whole ?? sortLinesByStart(lines)
    entry.whole = whole
    return whole
  }
  const part = partForLaneIndex(laneIndex)
  const forPart = entry[part] ?? linesForPart(lines, part)
  entry[part] = forPart
  return forPart
}
