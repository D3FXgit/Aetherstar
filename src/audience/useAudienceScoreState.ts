import { useMemo } from 'react'
import type { ScoreState } from '../contracts/types'
import { useAudienceFeed, useAudienceSlice } from './useAudienceState'

/**
 * Just the score table out of the audience broadcast (audience window only).
 * A slice of the shared audience store, not a second channel subscription.
 */
export function useAudienceScoreState(): ScoreState {
  useAudienceFeed()
  const { players, combo, rank } = useAudienceSlice('players', 'combo', 'rank')
  return useMemo(() => ({ players, combo, rank }), [players, combo, rank])
}
