// Game-domain types. Shared contracts live in src/contracts/types.ts and are
// consumed here, not extended.
import type { HitEvent, HitTier, SongNote } from '../contracts/types'

/** A chart's notes flattened in order, each given a stable, deterministic id. */
export interface NoteWithId extends SongNote {
  noteId: string
}

/**
 * One instant's pitch-match result.
 *
 * `tier` is per-note *visual* feedback only (the FX system's hit/miss
 * vocabulary) -- it no longer sets any points rate. `deviationCents` is the
 * signed, octave-aligned distance from the note, kept for cosmetic labels.
 */
export interface PitchMatch {
  tier: HitTier
  deviationCents: number
}

/**
 * A whole note's verdict, UltraStar-style: how many of its beats were sung in
 * tolerance, and what that is worth.
 */
export interface NoteJudgement extends PitchMatch {
  /** Fraction of the note's (charged) duration the singer was in tolerance for, 0..1. The raw measurement. */
  coverage: number
  /** Fraction of the note's beats sung in tolerance (beat-weighted), 0..1: the share of its points earned and of its pill filled. */
  credit: number
  /** Beats (weighted by length for a fractional last beat) judged in tolerance. */
  beatsHit: number
  /** Beats actually judged -- a beat entirely inside the onset grace or beyond the audio heard so far is not charged. */
  beatsCharged: number
}

/**
 * A `HitEvent` carrying this game's partial-credit and points figures.
 *
 * Additive and optional on purpose. `HitEvent` is a *contract* type read by the
 * session summary, the audience window and the stem mixer, none of which
 * should have to change for scoring detail -- and every one of them keeps compiling and behaving
 * identically, because a hit with no `credit` is simply a whole one.
 */
export interface JudgedHit extends HitEvent {
  /** 0..1, the fraction of the note's beats sung in tolerance. Absent means "fully credited". */
  credit?: number
  /** Exact (unrounded) points this note earned on the 10,000 scale. Absent counts as 0 toward the score. */
  points?: number
}

/** Party-karaoke-style line verdicts, best first. `poor` is not announced. */
export type LineRating = 'perfect' | 'great' | 'good' | 'ok' | 'poor'

/** The verdicts a singer actually sees announced, best first. */
export const ANNOUNCED_LINE_RATINGS = ['perfect', 'great', 'good', 'ok'] as const
export type AnnouncedLineRating = (typeof ANNOUNCED_LINE_RATINGS)[number]

/** How many of a singer's lines earned each announced verdict this song. */
export type LineTally = Record<AnnouncedLineRating, number>

export const EMPTY_LINE_TALLY: LineTally = { perfect: 0, great: 0, good: 0, ok: 0 }

/** Emitted the moment a singer's line ends (its last scorable note is judged). */
export interface LineRatingEvent {
  playerId: string
  /** Index into the lines this singer's lane was given. */
  lineIndex: number
  rating: LineRating
  /** What the HUD pops ("Perfect!", "Great!", "Good", "OK"); null for `poor`. */
  label: string | null
  /** Note points earned on the line / the line's maximum, 0..1. */
  fraction: number
  /** Exact line bonus awarded (already included in the singer's score). */
  bonusPoints: number
  /** Date.now() when the line was rated. */
  t: number
}

/** The scoring budget (see scoring/constants.ts) -- the single place real singing tests retune. */
export interface ScoringConstants {
  /** Per singer per song: `notePool + linePool`. */
  maxScore: number
  /** Shared over the part's notes by weighted length. */
  notePool: number
  /** Shared equally over the part's scorable lines. */
  linePool: number
  /** Weight of a golden / golden-rap beat relative to a normal one. */
  goldenMultiplier: number
}
