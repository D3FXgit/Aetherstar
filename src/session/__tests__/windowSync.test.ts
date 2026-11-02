// Proves both windows agree on state at every transition during real
// gameplay: the last payload the play-phase reporting hook sends toward the
// audience window always equals the live useScoreStore state at that moment,
// not a stale snapshot. This is the renderer-side half; the main-process
// relay/throttle has its own tests under electron/.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSessionScoreReporting } from '../useSessionScoreReporting'
import {
  AUDIENCE_PUBLISH_INTERVAL_MS,
  flushAudiencePublish,
  resetAudienceBroadcastForTests,
} from '../../audience/audienceBroadcast'
import { useHitStore } from '../../game/state/useHitStore'
import { useScoreStore } from '../../game/state/useScoreStore'

describe('play-phase window sync (both windows agree at every transition)', () => {
  let sentPayloads: unknown[]

  beforeEach(() => {
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [{ playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
    resetAudienceBroadcastForTests()
    sentPayloads = []
    // @ts-expect-error -- only reportScoreState matters for this test
    window.api = { audience: { reportScoreState: (state: unknown) => sentPayloads.push(state) } }
  })

  afterEach(() => {
    resetAudienceBroadcastForTests()
    delete window.api
  })

  it('the last state sent to the audience window always equals the real score store at that moment', () => {
    renderHook(() => useSessionScoreReporting([]))

    // Store changes go through the audience broadcast's ~30 Hz throttle; a
    // change inside the interval is delivered by the trailing send. Flushing
    // delivers it now, which is what "at that moment" means here.
    act(() => {
      useScoreStore.setState({ players: [{ playerId: 'p1', name: 'Alex', score: 100, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
      flushAudiencePublish()
    })
    // toMatchObject, not toEqual: the audience channel now carries the whole
    // screen the second display mirrors (src/audience/types.ts), of which the
    // score table is one slice. What this test guarantees is unchanged -- the
    // score the audience window is told about is the real store's, at that
    // moment -- and it is now asserted about those fields specifically (combo
    // is deprecated and always sent as 0).
    expect(sentPayloads.at(-1)).toMatchObject({
      players: useScoreStore.getState().players,
      rank: useScoreStore.getState().rank,
    })

    act(() => {
      useScoreStore.setState({ players: [{ playerId: 'p1', name: 'Alex', score: 250, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
      flushAudiencePublish()
    })
    // toMatchObject, not toEqual: the audience channel now carries the whole
    // screen the second display mirrors (src/audience/types.ts), of which the
    // score table is one slice. What this test guarantees is unchanged -- the
    // score the audience window is told about is the real store's, at that
    // moment -- and it is now asserted about those fields specifically (combo
    // is deprecated and always sent as 0).
    expect(sentPayloads.at(-1)).toMatchObject({
      players: useScoreStore.getState().players,
      rank: useScoreStore.getState().rank,
    })

    // Every intermediate transition was sent too, not just the final one.
    expect(sentPayloads.length).toBeGreaterThanOrEqual(2)
  })
  it('after a burst, the trailing send carries the final state and nothing older follows it', () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useSessionScoreReporting([]))
      vi.advanceTimersByTime(AUDIENCE_PUBLISH_INTERVAL_MS)

      act(() => {
        for (const score of [100, 150, 200, 250]) {
          useScoreStore.setState({ players: [{ playerId: 'p1', name: 'Alex', score, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
        }
      })
      // Leading send went out with the first change; the rest is pending.
      act(() => {
        vi.advanceTimersByTime(AUDIENCE_PUBLISH_INTERVAL_MS)
      })
      expect(sentPayloads.at(-1)).toMatchObject({ players: [{ playerId: 'p1', score: 250 }], combo: 0 })

      const count = sentPayloads.length
      act(() => {
        vi.advanceTimersByTime(AUDIENCE_PUBLISH_INTERVAL_MS * 10)
      })
      expect(sentPayloads.length).toBe(count)
      expect(sentPayloads.at(-1)).toMatchObject({ players: [{ playerId: 'p1', score: 250 }] })
    } finally {
      vi.useRealTimers()
    }
  })
})
