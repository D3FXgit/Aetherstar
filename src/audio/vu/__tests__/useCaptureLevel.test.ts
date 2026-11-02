import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePitchStore } from '../../pitchStore'
import type { DeviceCaptureState } from '../../types'
import { LEVEL_DECAY_MS, LEVEL_HOLD_MS, decayedLevel, useCaptureLevel } from '../useCaptureLevel'

const NOW = 1_700_000_000_000

function capture(overrides: Partial<DeviceCaptureState> = {}): DeviceCaptureState {
  return { latest: null, samples: [], latencyMs: null, level: 0, levelAt: 0, ...overrides }
}

function setCaptures(captures: Record<string, DeviceCaptureState>) {
  act(() => {
    usePitchStore.setState({ activeCaptures: captures })
  })
}

describe('decayedLevel', () => {
  it('holds the level untouched while frames are recent', () => {
    expect(decayedLevel(0.4, 0)).toBe(0.4)
    expect(decayedLevel(0.4, LEVEL_HOLD_MS)).toBe(0.4)
  })

  it('ramps to zero across the decay window once the hold expires', () => {
    expect(decayedLevel(0.4, LEVEL_HOLD_MS + LEVEL_DECAY_MS / 2)).toBeCloseTo(0.2, 6)
    expect(decayedLevel(0.4, LEVEL_HOLD_MS + LEVEL_DECAY_MS)).toBe(0)
  })

  it('reads zero for anything older than the decay window, however loud it was', () => {
    expect(decayedLevel(1, LEVEL_HOLD_MS + LEVEL_DECAY_MS + 1)).toBe(0)
    expect(decayedLevel(1, 60_000)).toBe(0)
  })

  it('returns a real number for nonsense inputs rather than propagating NaN into a CSS width', () => {
    expect(decayedLevel(Number.NaN, 0)).toBe(0)
    expect(decayedLevel(Number.POSITIVE_INFINITY, 0)).toBe(0)
    expect(decayedLevel(0.5, Number.NaN)).toBe(0)
    expect(decayedLevel(0.5, -100)).toBe(0)
    expect(decayedLevel(-0.5, 0)).toBe(0)
  })
})

describe('useCaptureLevel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    usePitchStore.setState({ activeCaptures: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 0 for a null device', () => {
    const { result } = renderHook(() => useCaptureLevel(null, 0))
    expect(result.current).toBe(0)
  })

  it('returns 0 for a device that is bound but has no active capture', () => {
    setCaptures({ 'mic-2': capture({ level: 0.8, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBe(0)
  })

  it('returns 0 for an active capture that has not reported a frame yet', () => {
    setCaptures({ 'mic-1': capture() })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBe(0)
  })

  it('returns the latest level for a live capture', () => {
    setCaptures({ 'mic-1': capture({ level: 0.42, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBeCloseTo(0.42, 6)
  })

  it('tracks the level as new frames arrive', () => {
    setCaptures({ 'mic-1': capture({ level: 0.1, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBeCloseTo(0.1, 6)

    setCaptures({ 'mic-1': capture({ level: 0.6, levelAt: NOW }) })
    expect(result.current).toBeCloseTo(0.6, 6)
  })

  it('reads a non-zero channel under its composite capture key, not the bare device id', () => {
    // Two rows can be bound to two channels of the same interface; they must
    // meter independently or a stereo box shows one level on both rows.
    setCaptures({
      'mic-1': capture({ level: 0.2, levelAt: NOW }),
      'mic-1#1': capture({ level: 0.7, levelAt: NOW }),
    })

    const channel0 = renderHook(() => useCaptureLevel('mic-1', 0))
    const channel1 = renderHook(() => useCaptureLevel('mic-1', 1))

    expect(channel0.result.current).toBeCloseTo(0.2, 6)
    expect(channel1.result.current).toBeCloseTo(0.7, 6)
  })

  it('decays a capture that stopped emitting all the way to zero', () => {
    // The regression this pins: a frozen bar reports a dead mic as live, which
    // is exactly the misdiagnosis the meters exist to prevent.
    setCaptures({ 'mic-1': capture({ level: 0.8, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBeCloseTo(0.8, 6)

    // advanceTimersByTime moves the mocked clock too, so the staleness the
    // hook reads and the timers that make it re-read stay in step.
    act(() => {
      vi.advanceTimersByTime(LEVEL_HOLD_MS + LEVEL_DECAY_MS / 2)
    })
    expect(result.current).toBeGreaterThan(0)
    expect(result.current).toBeLessThan(0.8)

    act(() => {
      vi.advanceTimersByTime(LEVEL_DECAY_MS)
    })
    expect(result.current).toBe(0)
  })

  it('holds steady while the stream is still inside the hold window', () => {
    setCaptures({ 'mic-1': capture({ level: 0.5, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))

    act(() => {
      vi.advanceTimersByTime(LEVEL_HOLD_MS - 10)
    })

    expect(result.current).toBeCloseTo(0.5, 6)
  })

  it('mounts a long-stale capture at zero rather than showing its last known level', () => {
    setCaptures({ 'mic-1': capture({ level: 0.9, levelAt: NOW - 10_000 }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBe(0)
  })

  it('picks the level back up when frames resume after a decay to zero', () => {
    setCaptures({ 'mic-1': capture({ level: 0.8, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(result.current).toBe(0)

    setCaptures({ 'mic-1': capture({ level: 0.3, levelAt: Date.now() }) })
    expect(result.current).toBeCloseTo(0.3, 6)
  })

  it('goes to zero when the capture is stopped and its store entry disappears', () => {
    setCaptures({ 'mic-1': capture({ level: 0.8, levelAt: NOW }) })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))
    expect(result.current).toBeCloseTo(0.8, 6)

    setCaptures({})
    expect(result.current).toBe(0)
  })

  it('never returns undefined or NaN, whatever the store holds', () => {
    const bad = capture({ level: Number.NaN, levelAt: NOW })
    setCaptures({ 'mic-1': bad })
    const { result } = renderHook(() => useCaptureLevel('mic-1', 0))

    expect(typeof result.current).toBe('number')
    expect(Number.isNaN(result.current)).toBe(false)
    expect(result.current).toBe(0)
  })

  it('stops its staleness timer once the level has fully decayed', () => {
    // Up to eight of these run at once; a timer per row that never clears
    // leaves eight intervals ticking forever behind an idle screen.
    setCaptures({ 'mic-1': capture({ level: 0.8, levelAt: NOW }) })
    const { unmount } = renderHook(() => useCaptureLevel('mic-1', 0))

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })
})
