import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStageClock, sameStageClock, watchStageClock } from '../stageClockMirror'
import { usePauseStore } from '../../stage/pause/pauseStore'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../calibration/types'

/**
 * Where the host's clock is read from.
 *
 * This is a *contract* with `StageMedia`, not an implementation detail: the
 * audience window's whole sense of time comes through this attribute, and it is
 * the only thing standing between "the lanes scroll with the song" and "the
 * lanes never move at all".
 */
const CLOCK_MARKUP = '<audio data-testid="stage-clock-audio"></audio>'

function mountClock(currentTime: number, paused = false): HTMLAudioElement {
  document.body.innerHTML = CLOCK_MARKUP
  const element = document.querySelector('audio') as HTMLAudioElement
  Object.defineProperty(element, 'currentTime', { value: currentTime, configurable: true })
  Object.defineProperty(element, 'paused', { value: paused, configurable: true })
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  usePauseStore.getState().reset()
  useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
})

describe('the speaker-delay offset', () => {
  it('carries the host calibration offset the stage folds into #GAP, clamped, with the raw position', () => {
    useCalibrationStore.setState({ settings: { ...DEFAULT_CALIBRATION_SETTINGS, outputOffsetMs: 120 } })
    mountClock(12.5)
    const reading = readStageClock()
    expect(reading?.positionMs).toBe(12500)
    expect(reading?.gapOffsetMs).toBe(120)

    useCalibrationStore.setState({ settings: { ...DEFAULT_CALIBRATION_SETTINGS, outputOffsetMs: 183_250 } })
    expect(readStageClock()?.gapOffsetMs).toBe(1000)
  })

  it('treats a changed offset as a new reading', () => {
    mountClock(12.5, true)
    const before = readStageClock()
    useCalibrationStore.setState({ settings: { ...DEFAULT_CALIBRATION_SETTINGS, outputOffsetMs: 80 } })
    expect(sameStageClock(before, readStageClock())).toBe(false)
  })
})

describe('the host pause menu', () => {
  // A paused clock alone is also the lead-in and the end of the song; the
  // audience shows "Paused" only when the host actually paused.
  it('says when the host has the pause menu up', () => {
    mountClock(30, true)
    expect(readStageClock()?.pausedByHost).toBe(false)

    usePauseStore.getState().pause()
    expect(readStageClock()?.pausedByHost).toBe(true)
  })

  it('carries the restart epoch, and treats a change of either as a new reading', () => {
    mountClock(30, true)
    const before = readStageClock()
    usePauseStore.getState().restart()
    const after = readStageClock()
    expect(after?.epoch).toBe((before?.epoch ?? 0) + 1)
    expect(sameStageClock(before, after)).toBe(false)

    usePauseStore.getState().pause()
    expect(sameStageClock(after, readStageClock())).toBe(false)
  })
})

describe('reading the host song clock', () => {
  it('reports the clock element position in milliseconds, stamped with the shared wall clock', () => {
    const before = Date.now()
    mountClock(12.5)
    const reading = readStageClock()
    expect(reading?.positionMs).toBe(12500)
    expect(reading?.paused).toBe(false)
    expect(reading?.atEpochMs).toBeGreaterThanOrEqual(before)
  })

  it('reports nothing when no song is on screen', () => {
    document.body.innerHTML = ''
    expect(readStageClock()).toBeNull()
  })

  it('treats an ended clock as paused', () => {
    // An ended element reports paused anyway; a *stalled* one does not, and a
    // clock that has stopped advancing while claiming to play would have the
    // audience's lanes scroll on past the end of the song.
    const element = mountClock(200, false)
    Object.defineProperty(element, 'ended', { value: true, configurable: true })
    expect(readStageClock()?.paused).toBe(true)
  })
})

describe('watching the host song clock', () => {
  it('publishes an anchor on every poll while the song is moving', () => {
    vi.useFakeTimers()
    const element = mountClock(1)
    const onChange = vi.fn()
    const stop = watchStageClock(onChange, 100)

    expect(onChange).toHaveBeenCalledTimes(1)
    Object.defineProperty(element, 'currentTime', { value: 1.1, configurable: true })
    vi.advanceTimersByTime(100)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.calls[1][0].positionMs).toBeCloseTo(1100, 6)

    stop()
    Object.defineProperty(element, 'currentTime', { value: 1.2, configurable: true })
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not re-publish a clock that has not moved', () => {
    // A paused song must not push ten identical payloads a second down a
    // channel the entire audience screen re-renders from.
    vi.useFakeTimers()
    mountClock(4, true)
    const onChange = vi.fn()
    const stop = watchStageClock(onChange, 100)
    vi.advanceTimersByTime(1000)
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
  })

  it('publishes once when the song goes away', () => {
    vi.useFakeTimers()
    mountClock(4)
    const onChange = vi.fn()
    const stop = watchStageClock(onChange, 100)
    document.body.innerHTML = ''
    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(onChange).toHaveBeenCalledTimes(2)
    stop()
  })
})

describe('sameStageClock', () => {
  it('ignores sub-millisecond wobble but not a pause', () => {
    const a = { positionMs: 1000, atEpochMs: 1, paused: false }
    expect(sameStageClock(a, { ...a, positionMs: 1000.2, atEpochMs: 999 })).toBe(true)
    expect(sameStageClock(a, { ...a, positionMs: 1100 })).toBe(false)
    expect(sameStageClock(a, { ...a, paused: true })).toBe(false)
    expect(sameStageClock(a, null)).toBe(false)
    expect(sameStageClock(null, null)).toBe(true)
  })
})
