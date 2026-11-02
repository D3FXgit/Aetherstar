import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHitStore, usePitchStore, useScoreStore } from '../stores'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  usePitchStore.getState().stop()
  useHitStore.getState().stop()
  useScoreStore.getState().stop()
  vi.useRealTimers()
})

describe('usePitchStore', () => {
  it('starts empty and accumulates samples once started and ticked', () => {
    expect(usePitchStore.getState().latest).toBeNull()

    usePitchStore.getState().start('dev-mic')
    vi.advanceTimersByTime(500)

    const state = usePitchStore.getState()
    expect(state.latest).not.toBeNull()
    expect(state.samples.length).toBeGreaterThan(0)
  })
})

describe('useHitStore', () => {
  it('starts empty and accumulates hit events once started and ticked', () => {
    expect(useHitStore.getState().latest).toBeNull()

    useHitStore.getState().start('player-1')
    vi.advanceTimersByTime(3000)

    const state = useHitStore.getState()
    expect(state.latest).not.toBeNull()
    expect(state.events.length).toBeGreaterThan(0)
  })
})

describe('useScoreStore', () => {
  it('starts with the seeded players and updates scores once started and ticked', () => {
    const seed = {
      players: [
        { playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 },
        { playerId: 'p2', name: 'Sam', score: 0, combo: 0, rank: 2 },
      ],
      combo: 0,
      rank: ['p1', 'p2'],
    }

    useScoreStore.getState().start(seed)
    vi.advanceTimersByTime(3000)

    const state = useScoreStore.getState()
    const totalScore = state.players.reduce((sum, p) => sum + p.score, 0)
    expect(totalScore).toBeGreaterThan(0)
  })
})
