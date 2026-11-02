// Session-domain types.
import type { LibrarySong } from '../library/types'
import type { Difficulty } from '../calibration/types'
import type { LineTally } from '../game/types'

/**
 * How a night is played.
 *
 * - `classic` (shown as "Solo/Duet"): sing a song, alone or as a duet.
 * - `battle` (shown as "Versus"): two or more singers head to head.
 * - `party`: the roulette that draws songs and singers.
 * - `jukebox`: songs played back to back with video and lyrics, no scoring.
 *
 * The internal names are compared against elsewhere, so they stay as they are.
 */
export type SessionMode = 'classic' | 'battle' | 'party' | 'jukebox'

/** i18n keys for the mode labels, shared by every screen that names a mode. */
export const SESSION_MODE_LABEL_KEYS: Record<SessionMode, string> = {
  classic: 'songSelect.mode.classic',
  battle: 'songSelect.mode.battle',
  party: 'songSelect.mode.party',
  jukebox: 'songSelect.mode.jukebox',
}

/** `jukebox` is a song playing in jukebox mode; the jukebox song list is `select`. */
export type SessionPhase =
  | 'idle'
  | 'select'
  | 'assign'
  | 'party-draw'
  | 'starting'
  | 'play'
  | 'results'
  | 'leaderboard'
  | 'jukebox'

export interface SessionSongResult {
  playerId: string
  score: number
  epicCount: number
  goodCount: number
  awfulCount: number
  /** The lyric text of whichever line scored the highest average tier this song, for the Results "best line" callout. */
  bestLine: string | null
  /**
   * How many lines earned each verdict (Perfect, Great, ...). Optional because
   * a result built without a live song (fixtures, older callers) has none;
   * results fall back to the note counts then.
   */
  lineCounts?: LineTally
}

export interface RatingResult {
  title: string
  stars: 1 | 2 | 3 | 4 | 5
}

export interface LeaderboardEntry {
  sessionId: string
  songPath: string
  /** Absent from per-song highscore reads, which are already about one known song. */
  songTitle?: string
  songArtist?: string
  playerId: string
  score: number
  epicCount: number
  goodCount: number
  awfulCount: number
  playedAt: number
  /** The difficulty the score was sung on. Leaderboard rows from before difficulties existed read as 'normal'. */
  difficulty?: Difficulty
}

/** One song's highscore table: every difficulty's own ladder unless `difficulty` narrows it to one. */
export interface SongHighscoreQuery {
  songPath: string
  difficulty?: Difficulty
  /** Entries per difficulty ladder (default 5). */
  limit?: number
}

export interface SessionStoreState {
  phase: SessionPhase
  mode: SessionMode
  sessionId: string | null
  selectedSong: LibrarySong | null
  assignedPlayerIds: string[]
  /** One entry per assigned player who sang this song. */
  lastResult: SessionSongResult[] | null
  songsPlayedThisSession: number
  /** Per-player sing counts tracked across rounds this session for fair party roulette draws. */
  sessionSingCounts: Record<string, number>
  /** Shuffled song catalogue cursor persisted across party rounds. */
  songCatalogueCursor: number
  /** Jukebox: songs waiting to play after the current one, in order. */
  jukeboxQueue: LibrarySong[]
  /** Jukebox: bumped on every song start, so replaying the same song remounts the stage. */
  jukeboxPlayId: number
  /** Jukebox: the Skip / Back to list menu over the playing song. */
  jukeboxMenuOpen: boolean
}
