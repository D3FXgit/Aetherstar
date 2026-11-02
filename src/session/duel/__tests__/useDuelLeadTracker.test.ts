import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDuelLeadTracker } from '../useDuelLeadTracker'
import { useScoreStore } from '../../../game/state/useScoreStore'

describe('useDuelLeadTracker', () => {
  beforeEach(() => {
    useScoreStore.setState({
      players: [
        { playerId: 'p1', name: 'Alice', score: 1000, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Bob', score: 800, combo: 0, rank: 2 },
      ],
      combo: 0,
      rank: ['p1', 'p2'],
    })
  })

  it('correctly calculates leader and lead delta when player 1 is ahead', () => {
    const { result } = renderHook(() => useDuelLeadTracker('p1', 'p2'))

    expect(result.current.leaderPlayerId).toBe('p1')
    expect(result.current.leadDelta).toBe(200)
    // momentum is (s2 - s1) / 1500 = (800 - 1000) / 1500 = -0.1333...
    expect(result.current.momentum).toBeCloseTo(-200 / 1500, 2)
  })

  it('correctly tracks lead change when player 2 overtakes player 1', () => {
    const { result } = renderHook(() => useDuelLeadTracker('p1', 'p2'))

    expect(result.current.leaderPlayerId).toBe('p1')
    expect(result.current.leadSwapCount).toBe(0)

    act(() => {
      useScoreStore.setState({
        players: [
          { playerId: 'p1', name: 'Alice', score: 1000, combo: 0, rank: 2 },
          { playerId: 'p2', name: 'Bob', score: 1300, combo: 0, rank: 1 },
        ],
        combo: 0,
        rank: ['p2', 'p1'],
      })
    })

    expect(result.current.leaderPlayerId).toBe('p2')
    expect(result.current.leadDelta).toBe(300)
    expect(result.current.momentum).toBeCloseTo(300 / 1500, 2)
    expect(result.current.leadSwapCount).toBe(1)
  })

  it('handles tied scores with null leader and zero lead delta', () => {
    useScoreStore.setState({
      players: [
        { playerId: 'p1', name: 'Alice', score: 1500, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Bob', score: 1500, combo: 0, rank: 1 },
      ],
      combo: 0,
      rank: ['p1', 'p2'],
    })

    const { result } = renderHook(() => useDuelLeadTracker('p1', 'p2'))

    expect(result.current.leaderPlayerId).toBeNull()
    expect(result.current.leadDelta).toBe(0)
    expect(result.current.momentum).toBe(0)
  })

  it('clamps momentum between -1.0 and 1.0 when score difference exceeds 1500', () => {
    useScoreStore.setState({
      players: [
        { playerId: 'p1', name: 'Alice', score: 5000, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Bob', score: 1000, combo: 0, rank: 2 },
      ],
      combo: 0,
      rank: ['p1', 'p2'],
    })

    const { result } = renderHook(() => useDuelLeadTracker('p1', 'p2'))

    expect(result.current.leaderPlayerId).toBe('p1')
    expect(result.current.leadDelta).toBe(4000)
    expect(result.current.momentum).toBe(-1)
  })
})
