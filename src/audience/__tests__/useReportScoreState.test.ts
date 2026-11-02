import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReportScoreState } from '../useReportScoreState'
import { useScoreStore as useMockScoreStore } from '../../contracts/mocks/stores'
import { flushAudiencePublish, resetAudienceBroadcastForTests } from '../audienceBroadcast'

beforeEach(() => {
  // @ts-expect-error -- only reportScoreState matters for this test
  window.api = {
    audience: { reportScoreState: vi.fn() },
  } as Window['api']
})

afterEach(() => {
  resetAudienceBroadcastForTests()
  useMockScoreStore.getState().stop()
  delete window.api
})

describe('useReportScoreState', () => {
  it('reports the given store\'s current state to window.api.audience.reportScoreState whenever it changes', () => {
    renderHook(() => useReportScoreState(useMockScoreStore))

    act(() => {
      useMockScoreStore.setState({ players: [{ playerId: 'p1', name: 'Alex', score: 100, combo: 2, rank: 1 }], combo: 2, rank: ['p1'] })
      // Store changes are coalesced to one send per relay interval.
      flushAudiencePublish()
    })

    expect(window.api!.audience.reportScoreState).toHaveBeenCalledWith(
      expect.objectContaining({ players: [expect.objectContaining({ playerId: 'p1', score: 100 })] }),
    )
  })

  it('reports whichever store instance it is given, not a hardcoded import', () => {
    // A hand-built store-shaped object standing in for gameplay's real
    // useScoreStore, proving the hook does not import one specific module.
    let listener: (() => void) | undefined
    const fakeRealStore = {
      getState: () => ({ players: [{ playerId: 'p2', name: 'Sam', score: 500, combo: 0, rank: 1 }], combo: 0, rank: ['p2'] }),
      subscribe: (fn: () => void) => {
        listener = fn
        return () => {
          listener = undefined
        }
      },
    }

    renderHook(() => useReportScoreState(fakeRealStore))

    act(() => {
      listener?.()
      flushAudiencePublish()
    })

    expect(window.api!.audience.reportScoreState).toHaveBeenCalledWith(
      expect.objectContaining({ players: [expect.objectContaining({ playerId: 'p2', score: 500 })] }),
    )
  })
})
