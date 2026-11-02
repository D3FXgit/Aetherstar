import type { HitEvent, HitTier } from '../types'

const TIERS: HitTier[] = ['epic', 'good', 'awful']
const TIER_WEIGHTS = [0.4, 0.4, 0.2] // biased toward plausible-sounding play, not a real distribution

function pickTier(): HitTier {
  const roll = Math.random()
  let cumulative = 0
  for (let i = 0; i < TIERS.length; i++) {
    cumulative += TIER_WEIGHTS[i]
    if (roll <= cumulative) return TIERS[i]
  }
  return TIERS[TIERS.length - 1]
}

let noteCounter = 0

/** Mock hit-event generator — plausible tier/deviation for a given player/time, not real matching. */
export function generateHitEvent(t: number, playerId: string): HitEvent {
  const tier = pickTier()
  const deviationCents = tier === 'epic' ? Math.random() * 5 : tier === 'good' ? 5 + Math.random() * 30 : 30 + Math.random() * 70

  return {
    playerId,
    tier,
    noteId: `note-${noteCounter++}`,
    deviationCents,
    t,
  }
}
