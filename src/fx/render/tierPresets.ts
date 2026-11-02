import type { HitTier } from '../../contracts/types'
import { tokens } from '../../design/tokens'

export interface TierPreset {
  spriteNames: string[]
  particleCount: number
  color: string
  screenShake: boolean
  screenGlow: boolean
  sfxName: string
}

// A dimmed, desaturated coral for AWFUL, so a miss never looks like the raw
// accent used for interactive UI.
const DIMMED_CORAL = 'oklch(0.45 0.08 25)'

const EPIC_PARTICLE_COUNT = 40
const GOLDEN_EPIC_PARTICLE_COUNT = 70
const GOOD_PARTICLE_COUNT = 20
const AWFUL_PARTICLE_COUNT = 25

/** Tier -> visual/audio preset: EPIC bursts big with shake and glow, GOOD trails, AWFUL smokes and shakes. */
export function getTierPreset(tier: HitTier, isGoldenNote: boolean): TierPreset {
  switch (tier) {
    case 'epic':
      return {
        spriteNames: ['shards_epic', 'star_gold'],
        particleCount: isGoldenNote ? GOLDEN_EPIC_PARTICLE_COUNT : EPIC_PARTICLE_COUNT,
        color: tokens.accent.gold,
        screenShake: true,
        screenGlow: true,
        sfxName: 'hit_perfect',
      }
    case 'good':
      return {
        spriteNames: ['trail_neon'],
        particleCount: GOOD_PARTICLE_COUNT,
        color: tokens.accent.cyan,
        screenShake: false,
        screenGlow: false,
        sfxName: 'hit_good',
      }
    case 'awful':
      return {
        spriteNames: ['smoke_soft', 'glitch_tile'],
        particleCount: AWFUL_PARTICLE_COUNT,
        color: DIMMED_CORAL,
        screenShake: true,
        screenGlow: false,
        sfxName: 'hit_miss',
      }
  }
}
