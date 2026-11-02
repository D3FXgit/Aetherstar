// @vitest-environment node
// describe/expect/it/beforeEach/afterEach/vi come from Vitest's globals (vite.config.ts test.globals: true)
const { createScoreStateBroadcaster } = require('../state-broadcaster.cjs')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createScoreStateBroadcaster', () => {
  it('coalesces multiple reports within one interval into a single send of the latest state', () => {
    const send = vi.fn()
    const broadcaster = createScoreStateBroadcaster(send, 34)

    broadcaster.report('stateA')
    broadcaster.report('stateB')
    broadcaster.report('stateC')
    vi.advanceTimersByTime(34)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('stateC')
  })

  it('never sends more than once per interval, no matter how many reports arrive (message-rate ceiling)', () => {
    const send = vi.fn()
    const broadcaster = createScoreStateBroadcaster(send, 34)

    for (let i = 0; i < 50; i++) {
      broadcaster.report(`state-${i}`)
      vi.advanceTimersByTime(7) // 50 * 7ms = 350ms of wall time, ~10 intervals of 34ms
    }

    expect(send.mock.calls.length).toBeLessThanOrEqual(11)
  })

  it('does not send again if no new state was reported since the last send', () => {
    const send = vi.fn()
    const broadcaster = createScoreStateBroadcaster(send, 34)

    broadcaster.report('stateA')
    vi.advanceTimersByTime(34)
    vi.advanceTimersByTime(34)
    vi.advanceTimersByTime(34)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('getLatest() returns null before any report(), and the latest reported state immediately after, independent of the throttle timer', () => {
    const broadcaster = createScoreStateBroadcaster(vi.fn(), 34)

    expect(broadcaster.getLatest()).toBeNull()

    broadcaster.report('stateA')
    expect(broadcaster.getLatest()).toBe('stateA')
  })

  it('stop() clears the interval so no further sends happen', () => {
    const send = vi.fn()
    const broadcaster = createScoreStateBroadcaster(send, 34)

    broadcaster.report('stateA')
    broadcaster.stop()
    vi.advanceTimersByTime(100)

    expect(send).not.toHaveBeenCalled()
  })
})
