import { describe, expect, it, vi } from 'vitest'
import { applyStemFrame, INITIAL_STEM_FRAME_STATE, type StemFrameState } from '../useStemAudio'
import { DUCKED_GAIN, DUCK } from '../duckEnvelope'

type FakeMedia = HTMLMediaElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }

function fakeMedia(overrides: Partial<HTMLMediaElement> = {}): FakeMedia {
  return {
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    paused: false,
    ended: false,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    ...overrides,
  } as unknown as FakeMedia
}

function state(overrides: Partial<StemFrameState> = {}): StemFrameState {
  return { ...INITIAL_STEM_FRAME_STATE, lastFrameMs: 0, ...overrides }
}

describe('applyStemFrame', () => {
  it('never writes to the clock element — it is the one source of truth', () => {
    const clock = fakeMedia({ currentTime: 10 })
    const stem = fakeMedia({ currentTime: 9 }) // a full second out

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(clock.currentTime).toBe(10)
    expect(clock.playbackRate).toBe(1)
    expect(clock.pause).not.toHaveBeenCalled()
    expect(clock.play).not.toHaveBeenCalled()
  })

  // Regression guard for the measured finding in stemSync.ts: assigning
  // currentTime on a *playing* element costs 55-80ms of playback, so a
  // correction loop that seeks makes the drift worse and glitches the guide
  // vocal every time it fires.
  it('corrects a large drift with rate alone and never seeks a playing stem', () => {
    const clock = fakeMedia({ currentTime: 10 })
    const stem = fakeMedia({ currentTime: 9.5 }) // 500ms late

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(stem.currentTime).toBe(9.5)
    expect(stem.playbackRate).toBeGreaterThan(1)
  })

  it('silences and stops a stem that is beyond rate-only recovery, and never touches it again', () => {
    const clock = fakeMedia({ currentTime: 10 })
    const stem = fakeMedia({ currentTime: 5 }) // 5 seconds out: hopeless

    const after = applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(after.abandoned).toBe(true)
    expect(stem.volume).toBe(0)
    expect(stem.pause).toHaveBeenCalled()

    // A later frame must not restart it, even though it is now paused.
    stem.play.mockClear()
    applyStemFrame({ clock, stem: { ...stem, paused: true } as typeof stem, nowMs: 32, state: after })
    expect(stem.play).not.toHaveBeenCalled()
  })

  it('pauses the stem whenever the clock is paused, so no vocal ever plays on its own', () => {
    const clock = fakeMedia({ paused: true })
    const stem = fakeMedia({ paused: false })

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(stem.pause).toHaveBeenCalled()
  })

  it('pauses the stem when the clock has ended', () => {
    const clock = fakeMedia({ ended: true })
    const stem = fakeMedia({ paused: false })

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(stem.pause).toHaveBeenCalled()
  })

  it('lands the stem on the clock position BEFORE starting it, never after', () => {
    const clock = fakeMedia({ currentTime: 42 })
    const stem = fakeMedia({ paused: true, currentTime: 0 })

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(stem.currentTime).toBe(42)
    expect(stem.play).toHaveBeenCalled()
  })

  it('nudges playbackRate for a small drift and leaves the position alone', () => {
    const clock = fakeMedia({ currentTime: 10.03 })
    const stem = fakeMedia({ currentTime: 10 })

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(stem.playbackRate).toBeGreaterThan(1)
    expect(stem.currentTime).toBe(10)
  })

  it('holds unity rate and position inside the deadband', () => {
    const clock = fakeMedia({ currentTime: 10.01 })
    const stem = fakeMedia({ currentTime: 10 })

    applyStemFrame({ clock, stem, nowMs: 16, state: state() })

    expect(stem.playbackRate).toBe(1)
    expect(stem.currentTime).toBe(10)
  })

  it('ducks the stem toward -12dB while the singer keeps landing notes', () => {
    const clock = fakeMedia({ currentTime: 10 })
    const stem = fakeMedia({ currentTime: 10 })

    let current = state({ lastQualifyingHitAtMs: 0, gain: 1 })
    for (let now = 16; now <= DUCK.attackMs * 2; now += 16) {
      current = applyStemFrame({ clock, stem, nowMs: now, state: { ...current, lastQualifyingHitAtMs: now - 10 } })
    }

    expect(stem.volume).toBeLessThan(0.4)
    expect(stem.volume).toBeGreaterThanOrEqual(DUCKED_GAIN)
  })

  it('brings the guide vocal back once the singer has been off the note past the hold', () => {
    const clock = fakeMedia({ currentTime: 10 })
    const stem = fakeMedia({ currentTime: 10 })

    // Ducked, and the last good note was long enough ago to release.
    let current = state({ gain: DUCKED_GAIN, lastQualifyingHitAtMs: 0 })
    for (let now = DUCK.holdMs + 16; now <= DUCK.holdMs + DUCK.releaseMs * 2; now += 16) {
      current = applyStemFrame({ clock, stem, nowMs: now, state: current })
    }

    expect(stem.volume).toBeGreaterThan(0.9)
  })

  it('stays at full volume before the singer has landed anything', () => {
    const clock = fakeMedia({ currentTime: 10 })
    const stem = fakeMedia({ currentTime: 10 })

    applyStemFrame({ clock, stem, nowMs: 16, state: state({ gain: 1 }) })

    expect(stem.volume).toBe(1)
  })
})

// Loudness normalisation (src/audio/loudness.ts) is applied to the clock
// element's `volume`. The stem is a passenger and has to ride at the same
// level, so the ducking envelope is *relative* to the clock rather than
// absolute -- writing it straight into `stem.volume`, as this used to, played
// the guide vocal at full scale over a backing track pulled down 12 dB.
describe('applyStemFrame — relative to the clock level', () => {
  it('scales the ducking envelope by the clock element s own volume', () => {
    const clock = fakeMedia({ currentTime: 10, volume: 0.25 })
    const stem = fakeMedia({ currentTime: 10, volume: 0.25 })

    // No qualifying hit yet, so the envelope target is 1: unducked.
    const next = applyStemFrame({ clock, stem, nowMs: 16, state: state({ gain: 1 }) })

    expect(next.gain).toBe(1)
    expect(stem.volume).toBeCloseTo(0.25, 10)
  })

  it('keeps the duck the same number of dB below the song whatever the song s level', () => {
    const loud = fakeMedia({ currentTime: 10, volume: 1 })
    const quiet = fakeMedia({ currentTime: 10, volume: 0.25 })
    const stemA = fakeMedia({ currentTime: 10 })
    const stemB = fakeMedia({ currentTime: 10 })
    const ducked = state({ gain: DUCKED_GAIN, lastQualifyingHitAtMs: 16 })

    applyStemFrame({ clock: loud, stem: stemA, nowMs: 16, state: ducked })
    applyStemFrame({ clock: quiet, stem: stemB, nowMs: 16, state: ducked })

    expect(stemA.volume / loud.volume).toBeCloseTo(stemB.volume / quiet.volume, 10)
  })

  it('clamps the product into 0..1, since an out-of-range volume assignment throws', () => {
    const clock = fakeMedia({ currentTime: 10, volume: 1 })
    const stem = fakeMedia({ currentTime: 10 })

    // A gain that has been nudged fractionally past 1 by floating point.
    applyStemFrame({ clock, stem, nowMs: 16, state: state({ gain: 1 + 1e-12 }) })

    expect(stem.volume).toBeLessThanOrEqual(1)
    expect(stem.volume).toBeGreaterThanOrEqual(0)
  })
})
