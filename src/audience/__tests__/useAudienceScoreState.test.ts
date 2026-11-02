import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudienceScoreState } from '../useAudienceScoreState'

let scoreStateCallback: ((state: unknown) => void) | undefined

beforeEach(() => {
  scoreStateCallback = undefined
  // @ts-expect-error -- only onScoreState matters for this test
  window.api = {
    audience: {
      onScoreState: vi.fn((cb: (state: unknown) => void) => {
        scoreStateCallback = cb
        return () => {}
      }),
    },
  } as Window['api']
})

afterEach(() => {
  delete window.api
})

describe('useAudienceScoreState', () => {
  it('subscribes to window.api.audience.onScoreState and returns the latest pushed state', () => {
    const { result } = renderHook(() => useAudienceScoreState())

    expect(result.current).toEqual({ players: [], combo: 0, rank: [] })

    act(() => {
      scoreStateCallback?.({ players: [{ playerId: 'p1', name: 'Alex', score: 50, combo: 1, rank: 1 }], combo: 1, rank: ['p1'] })
    })

    expect(result.current).toEqual({ players: [{ playerId: 'p1', name: 'Alex', score: 50, combo: 1, rank: 1 }], combo: 1, rank: ['p1'] })
  })
})
