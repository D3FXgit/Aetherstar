import { describe, expect, it } from 'vitest'
import { generateScoreTick } from '../score'
import type { ScoreState } from '../../types'

function initialState(): ScoreState {
  return {
    players: [
      { playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 },
      { playerId: 'p2', name: 'Sam', score: 0, combo: 0, rank: 2 },
      { playerId: 'p3', name: 'Jordan', score: 0, combo: 0, rank: 3 },
    ],
    combo: 0,
    rank: ['p1', 'p2', 'p3'],
  }
}

describe('generateScoreTick', () => {
  it('never decreases a player score and keeps rank a permutation of player ids', () => {
    let state = initialState()
    const playerIds = new Set(state.players.map((p) => p.playerId))

    for (let i = 0; i < 200; i++) {
      const prevScores = new Map(state.players.map((p) => [p.playerId, p.score]))
      state = generateScoreTick(state)

      for (const player of state.players) {
        expect(player.score).toBeGreaterThanOrEqual(prevScores.get(player.playerId) ?? 0)
      }
      expect(new Set(state.rank)).toEqual(playerIds)
      expect(state.rank).toHaveLength(state.players.length)
    }
  })

  it('changes rank order across repeated ticks (rank swaps happen)', () => {
    let state = initialState()
    const rankSnapshots = new Set<string>()

    for (let i = 0; i < 200; i++) {
      state = generateScoreTick(state)
      rankSnapshots.add(state.rank.join(','))
    }

    expect(rankSnapshots.size).toBeGreaterThan(1)
  })
})
