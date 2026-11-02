import type { HitTier } from '../contracts/types'

/**
 * The public "fire an effect" input. Kept separate from `HitEvent`, which
 * carries no note-kind information, rather than extending the shared contract.
 */
export interface FxTriggerInput {
  tier: HitTier
  isGoldenNote?: boolean
}
