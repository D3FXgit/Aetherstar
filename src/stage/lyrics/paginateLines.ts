import type { SongLine } from '../../contracts/types'

/** The two-line floating window: the active line plus its preview, or null past the chart's end. */
export function paginateLines(
  lines: SongLine[],
  currentLineIndex: number,
): { currentLine: SongLine | null; nextLine: SongLine | null } {
  return {
    currentLine: lines[currentLineIndex] ?? null,
    nextLine: lines[currentLineIndex + 1] ?? null,
  }
}
