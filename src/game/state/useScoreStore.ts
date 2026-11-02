import { create } from 'zustand'
import type { PlayerScore, ScoreState } from '../../contracts/types'
import { EMPTY_LINE_TALLY, type JudgedHit, type LineRatingEvent, type LineTally, type NoteWithId } from '../types'

// The live score store, in the shape of src/contracts/mocks/stores.ts's mock.
interface ScoreStoreState extends ScoreState {
  /**
   * Each singer's exact (unrounded) running total. `PlayerScore.score` is this
   * rounded; keeping the exact sum is what lets a perfect run land on exactly
   * 10,000 instead of drifting a few points from per-note rounding.
   */
  exactScoreByPlayerId: Record<string, number>
  /** The newest line verdict of each singer -- what the HUD pops. */
  lineRatingByPlayerId: Record<string, LineRatingEvent>
  /** The newest line verdict of anyone, for consumers that want one stream. */
  latestLineRating: LineRatingEvent | null
  /**
   * Every announced verdict each singer has earned this song, counted as they
   * land -- the HUD only needs the newest, but results summarise the lot.
   */
  lineTallyByPlayerId: Record<string, LineTally>
  /** Shorthand for `applyHits([{ event, note }])`. */
  applyHit: (event: JudgedHit, note: NoteWithId) => void
  /**
   * Apply a frame's judged notes and completed lines as ONE store write.
   *
   * Points come from each event's `points` (computed by the lane against its
   * own part's scoring plan) and each line's `bonusPoints`; an event without
   * `points` scores nothing. There is no combo.
   */
  applyHits: (hits: { event: JudgedHit; note?: NoteWithId }[], lineRatings?: LineRatingEvent[]) => void
  reset: (seed: ScoreState) => void
}

const EMPTY_SCORE_STATE: ScoreState = { players: [], combo: 0, rank: [] }

function rerank(players: PlayerScore[]): PlayerScore[] {
  const ranked = [...players].sort((a, b) => b.score - a.score)
  const rankByPlayerId = new Map(ranked.map((player, index) => [player.playerId, index + 1]))
  // Unchanged players keep their object identity, so a memoised score card
  // for a singer whose score and rank did not move does not re-render.
  return players.map((player) => {
    const rank = rankByPlayerId.get(player.playerId) ?? player.rank
    return rank === player.rank ? player : { ...player, rank }
  })
}

export const useScoreStore = create<ScoreStoreState>((set, get) => ({
  ...EMPTY_SCORE_STATE,
  exactScoreByPlayerId: {},
  lineRatingByPlayerId: {},
  latestLineRating: null,
  lineTallyByPlayerId: {},

  applyHit: (event, note) => get().applyHits([{ event, note }]),

  applyHits: (hits, lineRatings = []) => {
    if (hits.length === 0 && lineRatings.length === 0) return

    const state = get()
    const gained = new Map<string, number>()
    const add = (playerId: string, points: number | undefined) => {
      if (!(typeof points === 'number' && Number.isFinite(points) && points > 0)) return
      gained.set(playerId, (gained.get(playerId) ?? 0) + points)
    }
    for (const { event } of hits) add(event.playerId, event.points)
    for (const line of lineRatings) add(line.playerId, line.bonusPoints)

    let exactScoreByPlayerId = state.exactScoreByPlayerId
    let players = state.players
    if (gained.size > 0) {
      exactScoreByPlayerId = { ...exactScoreByPlayerId }
      players = players.map((player) => {
        const delta = gained.get(player.playerId)
        if (delta === undefined) return player
        // Seeded from the published score the first time, so a store reset to
        // a non-zero seed (a resumed session, a test) keeps counting from it.
        const exact = (exactScoreByPlayerId[player.playerId] ?? player.score) + delta
        exactScoreByPlayerId[player.playerId] = exact
        return { ...player, score: Math.round(exact), combo: 0 }
      })
    }

    let lineRatingByPlayerId = state.lineRatingByPlayerId
    let latestLineRating = state.latestLineRating
    let lineTallyByPlayerId = state.lineTallyByPlayerId
    if (lineRatings.length > 0) {
      lineRatingByPlayerId = { ...lineRatingByPlayerId }
      lineTallyByPlayerId = { ...lineTallyByPlayerId }
      for (const line of lineRatings) {
        lineRatingByPlayerId[line.playerId] = line
        if (line.rating === 'poor') continue
        const tally = lineTallyByPlayerId[line.playerId] ?? EMPTY_LINE_TALLY
        lineTallyByPlayerId[line.playerId] = { ...tally, [line.rating]: tally[line.rating] + 1 }
      }
      latestLineRating = lineRatings[lineRatings.length - 1]
    }

    const reranked = gained.size > 0 ? rerank(players) : players
    const rank = gained.size > 0 ? [...reranked].sort((a, b) => a.rank - b.rank).map((p) => p.playerId) : state.rank

    set({
      players: reranked,
      rank,
      combo: 0,
      exactScoreByPlayerId,
      lineRatingByPlayerId,
      latestLineRating,
      lineTallyByPlayerId,
    })
  },

  reset: (seed) =>
    set({
      ...seed,
      combo: 0,
      exactScoreByPlayerId: {},
      lineRatingByPlayerId: {},
      latestLineRating: null,
      lineTallyByPlayerId: {},
    }),
}))
