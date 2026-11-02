// Thin window.api.session wrapper. Degrades to empty results / no-ops when the
// preload bridge is absent.
import type { Difficulty } from '../calibration/types'
import type { LeaderboardEntry, SongHighscoreQuery } from './types'

interface StartSessionResult {
  id: string
  startedAt: number
}

interface RecordEntryInput {
  sessionId: string
  songPath: string
  playerId: string
  score: number
  epicCount: number
  goodCount: number
  awfulCount: number
  /** The difficulty this singer sang on, so highscores compare like with like. */
  difficulty?: Difficulty
}

function sessionApi() {
  return window.api?.session
}

export const start = (): Promise<StartSessionResult | null> =>
  sessionApi()?.start() ?? Promise.resolve(null)

export const recordEntry = (entry: RecordEntryInput): Promise<void> =>
  sessionApi()?.recordEntry(entry) ?? Promise.resolve()

export const listLeaderboard = (): Promise<LeaderboardEntry[]> =>
  sessionApi()?.listLeaderboard() ?? Promise.resolve([])

/**
 * One song's highscores (best first, per difficulty ladder). Resolves to an
 * empty list rather than rejecting: a missing record table must never take
 * the song selector or the results screen down with it. A preload from before
 * this method existed reads as "no records yet" too.
 */
export const listSongHighscores = (query: SongHighscoreQuery): Promise<LeaderboardEntry[]> => {
  const listing = sessionApi()?.listSongHighscores?.(query)
  return listing ? listing.then((entries) => entries ?? []).catch(() => []) : Promise.resolve([])
}
