import { describe, expect, it, beforeEach } from 'vitest'
import { micHealthMessage, useMicHealthStore } from '../useMicHealthStore'

describe('useMicHealthStore', () => {
  beforeEach(() => {
    useMicHealthStore.getState().reset()
  })

  it('records a status and the capture key it belongs to, per player', () => {
    useMicHealthStore.getState().report('p1', 'no-capture', 'mic-1#1')
    useMicHealthStore.getState().report('p2', 'ok', 'mic-2')

    expect(useMicHealthStore.getState().byPlayerId).toEqual({
      p1: { status: 'no-capture', deviceId: 'mic-1#1' },
      p2: { status: 'ok', deviceId: 'mic-2' },
    })
  })

  /**
   * The gameplay frame loop reports every animation frame. A `set()` per frame
   * would re-render every subscriber 60-120 times a second for the length of a
   * song, so an unchanged report has to be a genuine no-op -- not merely an
   * equal value in a fresh object.
   */
  it('is a no-op when the reported status is unchanged, so a per-frame caller cannot thrash subscribers', () => {
    useMicHealthStore.getState().report('p1', 'ok', 'mic-1')
    const first = useMicHealthStore.getState().byPlayerId

    useMicHealthStore.getState().report('p1', 'ok', 'mic-1')
    expect(useMicHealthStore.getState().byPlayerId).toBe(first)

    useMicHealthStore.getState().report('p1', 'no-frames', 'mic-1')
    expect(useMicHealthStore.getState().byPlayerId).not.toBe(first)
  })

  it('notices a change of capture key even when the status is the same', () => {
    useMicHealthStore.getState().report('p1', 'ok', 'mic-1')
    const first = useMicHealthStore.getState().byPlayerId

    useMicHealthStore.getState().report('p1', 'ok', 'mic-2')
    expect(useMicHealthStore.getState().byPlayerId).not.toBe(first)
    expect(useMicHealthStore.getState().byPlayerId.p1?.deviceId).toBe('mic-2')
  })

  it('clears one player without disturbing the others, and no-ops on an unknown player', () => {
    useMicHealthStore.getState().report('p1', 'ok', 'mic-1')
    useMicHealthStore.getState().report('p2', 'ok', 'mic-2')

    useMicHealthStore.getState().clear('p1')
    expect(useMicHealthStore.getState().byPlayerId).toEqual({ p2: { status: 'ok', deviceId: 'mic-2' } })

    const unchanged = useMicHealthStore.getState().byPlayerId
    useMicHealthStore.getState().clear('nobody')
    expect(useMicHealthStore.getState().byPlayerId).toBe(unchanged)
  })

  /**
   * Every failure mode has to produce words a player can act on. A status that
   * renders as nothing is exactly the silent zero this store exists to end.
   */
  it('gives every failure status a message, and the healthy ones none', () => {
    expect(micHealthMessage('no-device')).toMatch(/no microphone/i)
    expect(micHealthMessage('no-capture')).toMatch(/not running/i)
    expect(micHealthMessage('no-frames')).toMatch(/stopped sending/i)

    expect(micHealthMessage('ok')).toBeNull()
    expect(micHealthMessage('starting')).toBeNull()
  })

  it('says in every failure message that nothing is being scored, not just that something is wrong', () => {
    for (const status of ['no-device', 'no-capture', 'no-frames'] as const) {
      expect(micHealthMessage(status)).toMatch(/nothing is being scored/i)
    }
  })
})
