// `play` phase: tallies each singer's note tiers and best line from the hit
// store, and reports the live score store to the audience window. Keyed by
// player, so singers sharing a song are scored independently.
import { useEffect, useRef, useState } from 'react'
import type { SongLine } from '../contracts/types'
import { useHitStore } from '../game/state/useHitStore'
import { useScoreStore } from '../game/state/useScoreStore'
import { useReportScoreState } from '../audience/useReportScoreState'
import { linesForLane } from '../multiplayer/laneParts'

export interface SessionScoreTallies {
  epicCount: number
  goodCount: number
  awfulCount: number
  bestLine: string | null
}

export type SessionScoreTalliesByPlayer = Record<string, SessionScoreTallies>

const TIER_WEIGHT: Record<string, number> = { epic: 2, good: 1, awful: 0 }

export const EMPTY_TALLIES: SessionScoreTallies = { epicCount: 0, goodCount: 0, awfulCount: 0, bestLine: null }

/**
 * `note-N` -> line, over ONE lane's lines, numbered exactly as `flattenNotes`
 * numbers them. Note ids are only unique within the lines a lane was handed
 * (see laneParts.ts): in a duet P2's `note-0` is a different note from P1's.
 */
function buildNoteIdToLine(lines: SongLine[]): Map<string, SongLine> {
  const map = new Map<string, SongLine>()
  let index = 0
  for (const line of lines) {
    for (let n = 0; n < line.notes.length; n += 1) {
      map.set(`note-${index}`, line)
      index++
    }
  }
  return map
}

/**
 * Whether a chart spells out its own word breaks. UltraStar syllables carry
 * their spaces (`Wake` then ` up,`), so such a chart's line is its syllables
 * run together. A chart with no whitespace in any syllable at all is written
 * a word per note (the demo song is) -- the stage lyric line spaces every
 * note, so that is the line the singer saw.
 */
export function chartSpellsWordBreaks(lines: readonly SongLine[]): boolean {
  return lines.some((line) => line.notes.some((note) => /\s/.test(note.syllable)))
}

/** A line's lyric as one readable string: its words single-spaced, nothing at either end. */
export function lineText(line: SongLine, spelledWordBreaks: boolean): string {
  return line.notes
    .map((note) => note.syllable)
    .join(spelledWordBreaks ? '' : ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface LineScore {
  total: number
  count: number
}

// A stable module-level reference (not `{}` inlined at each reset) -- setting
// state to a fresh object literal every time would defeat React's
// same-reference bail-out and re-run the `[lines]` reset effect on every
// render whenever a caller passes a non-memoized `lines` array (e.g. an
// inline `[]` literal), looping forever.
const EMPTY_TALLIES_BY_PLAYER: SessionScoreTalliesByPlayer = {}

const NO_PLAYERS: readonly string[] = []

/**
 * @param lines the song's whole chart
 * @param assignedPlayerIds the line-up, in pick order -- a singer's position in
 *   it is their lane (see MultiplayerGameplay), and so which lines their note
 *   ids refer to. A player not in it is read as lane 0.
 */
export function useSessionScoreReporting(
  lines: SongLine[],
  assignedPlayerIds: readonly string[] = NO_PLAYERS,
): SessionScoreTalliesByPlayer {
  const [talliesByPlayer, setTalliesByPlayer] = useState<SessionScoreTalliesByPlayer>(EMPTY_TALLIES_BY_PLAYER)
  /**
   * How many of the hit store's `total` hits have been tallied. Not an index
   * into `events`: that window stops growing at `MAX_RETAINED_HITS`, so an
   * index into it froze every tally ~256 notes into a song.
   */
  const consumedTotalRef = useRef(0)
  const linesRef = useRef(lines)
  const spelledWordBreaksRef = useRef(chartSpellsWordBreaks(lines))
  const assignedRef = useRef(assignedPlayerIds)
  /** Per lane-lines array (shared by every singer on the same part), its note-id map. */
  const noteMapsRef = useRef(new WeakMap<SongLine[], Map<string, SongLine>>())
  // Each player accumulates their own best-line tally independently -- one
  // player's awful hit on a line must never drag down another player's
  // average on that same shared/solo line.
  const lineScoresByPlayerRef = useRef(new Map<string, Map<SongLine, LineScore>>())

  useReportScoreState(useScoreStore)

  useEffect(() => {
    assignedRef.current = assignedPlayerIds
  }, [assignedPlayerIds])

  useEffect(() => {
    linesRef.current = lines
    spelledWordBreaksRef.current = chartSpellsWordBreaks(lines)
    noteMapsRef.current = new WeakMap()
    lineScoresByPlayerRef.current = new Map()
    // Hits already in the store were judged against whatever was on before.
    consumedTotalRef.current = useHitStore.getState().total
    setTalliesByPlayer(EMPTY_TALLIES_BY_PLAYER)
  }, [lines])

  useEffect(() => {
    const noteIdToLineFor = (playerId: string): Map<string, SongLine> => {
      const laneIndex = Math.max(0, assignedRef.current.indexOf(playerId))
      const laneLines = linesForLane(linesRef.current, laneIndex)
      let map = noteMapsRef.current.get(laneLines)
      if (!map) {
        map = buildNoteIdToLine(laneLines)
        noteMapsRef.current.set(laneLines, map)
      }
      return map
    }

    return useHitStore.subscribe((state) => {
      // A reset starts the count over.
      if (state.total < consumedTotalRef.current) consumedTotalRef.current = 0
      const fresh = state.total - consumedTotalRef.current
      if (fresh <= 0) return
      consumedTotalRef.current = state.total
      // The newest `fresh` hits are the last `fresh` entries of the window.
      const newEvents = state.events.slice(Math.max(0, state.events.length - fresh))
      if (newEvents.length === 0) return

      const deltaByPlayer = new Map<string, { epic: number; good: number; awful: number }>()

      for (const event of newEvents) {
        const delta = deltaByPlayer.get(event.playerId) ?? { epic: 0, good: 0, awful: 0 }
        if (event.tier === 'epic') delta.epic++
        else if (event.tier === 'good') delta.good++
        else delta.awful++
        deltaByPlayer.set(event.playerId, delta)

        const line = noteIdToLineFor(event.playerId).get(event.noteId)
        if (line) {
          let lineScores = lineScoresByPlayerRef.current.get(event.playerId)
          if (!lineScores) {
            lineScores = new Map()
            lineScoresByPlayerRef.current.set(event.playerId, lineScores)
          }
          const entry = lineScores.get(line) ?? { total: 0, count: 0 }
          entry.total += TIER_WEIGHT[event.tier] ?? 0
          entry.count += 1
          lineScores.set(line, entry)
        }
      }

      setTalliesByPlayer((prev) => {
        const next = { ...prev }
        for (const [playerId, delta] of deltaByPlayer) {
          const prevTallies = prev[playerId] ?? EMPTY_TALLIES

          // Only a line the singer actually landed something on is a "best
          // line": a singer who hit nothing (every note awful) has none.
          let bestLine: string | null = null
          let bestAverage = 0
          for (const [line, { total, count }] of lineScoresByPlayerRef.current.get(playerId) ?? []) {
            const average = total / count
            if (average > bestAverage) {
              const text = lineText(line, spelledWordBreaksRef.current)
              if (!text) continue
              bestAverage = average
              bestLine = text
            }
          }

          next[playerId] = {
            epicCount: prevTallies.epicCount + delta.epic,
            goodCount: prevTallies.goodCount + delta.good,
            awfulCount: prevTallies.awfulCount + delta.awful,
            bestLine,
          }
        }
        return next
      })
    })
  }, [])

  return talliesByPlayer
}
