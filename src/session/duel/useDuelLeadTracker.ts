import { useEffect, useRef, useState } from 'react'
import { useScoreStore } from '../../game/state/useScoreStore'
import { useSfx } from '../../audio/useSfx'
import type { PlayerScore } from '../../contracts/types'

export interface BattleMetrics {
  leaderPlayerId: string | null
  leadDelta: number
  /** -1.0 (Player 1 dominating) to +1.0 (Player 2 dominating) */
  momentum: number
  leadSwapCount: number
  lastLeadSwapTime: number
}

/**
 * Tracks the live point differential, momentum, and lead swaps between
 * two competing singers in Battle Duel mode.
 */
export function useDuelLeadTracker(
  player1Id: string | null,
  player2Id: string | null,
  overrideScores?: PlayerScore[],
  silent = false,
): BattleMetrics {
  const storeScores = useScoreStore((state) => state.players)
  const scores = overrideScores ?? storeScores
  const playSfx = useSfx((state) => state.play)
  const prevLeaderRef = useRef<string | null>(null)
  const [leadSwapCount, setLeadSwapCount] = useState(0)
  const [lastLeadSwapTime, setLastLeadSwapTime] = useState(0)

  const s1 = player1Id ? (scores.find((p) => p.playerId === player1Id)?.score ?? 0) : 0
  const s2 = player2Id ? (scores.find((p) => p.playerId === player2Id)?.score ?? 0) : 0

  const diff = s2 - s1 // positive when player 2 is ahead
  const leadDelta = Math.abs(diff)
  const leaderPlayerId = diff < 0 ? player1Id : diff > 0 ? player2Id : null

  // Momentum clamped to [-1.0, 1.0], using a 1500-point spread for full deflection
  const momentum = Math.max(-1, Math.min(1, diff / 1500))

  useEffect(() => {
    if (!leaderPlayerId) return
    if (prevLeaderRef.current && leaderPlayerId !== prevLeaderRef.current) {
      setLeadSwapCount((c) => c + 1)
      setLastLeadSwapTime(Date.now())
      if (!silent) {
        playSfx('uiBing')
      }
    }
    prevLeaderRef.current = leaderPlayerId
  }, [leaderPlayerId, playSfx, silent])

  return {
    leaderPlayerId,
    leadDelta,
    momentum,
    leadSwapCount,
    lastLeadSwapTime,
  }
}
