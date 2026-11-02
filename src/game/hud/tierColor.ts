import type { HitTier } from '../../contracts/types'
import { tokens } from '../../design/tokens'

/** Shared per-note tier -> accent-color lookup for the lane FX (NoteLane, LaneHitFx). Visual only -- tiers set no points. */
export const TIER_COLOR: Record<HitTier, string> = {
  epic: tokens.accent.gold,
  good: tokens.accent.cyan,
  awful: tokens.accent.coral,
}

/**
 * A cleared golden note's colour, whatever tier it was judged at.
 *
 * Named separately from `TIER_COLOR.epic` even though both are the gold token:
 * they mean different things ("you sang it perfectly" vs "this note was worth
 * double"), and a future retune of one must not silently move the other.
 */
export const GOLDEN_COLOR = tokens.accent.gold
