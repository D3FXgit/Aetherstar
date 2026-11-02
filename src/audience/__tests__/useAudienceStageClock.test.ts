import { describe, expect, it } from 'vitest'
import { playbackBeat, playbackPositionMs } from '../useAudienceStageClock'
import { msToBeat } from '../../stage/timing/beatMs'
import type { AudiencePlayback } from '../types'

const META = { bpm: 250, gap: 24065 }

function anchor(overrides: Partial<AudiencePlayback> = {}): AudiencePlayback {
  return { positionMs: 30000, atEpochMs: 1_700_000_000_000, paused: false, ...overrides }
}

/**
 * The audience window's clock is an *extrapolation*, and that is the whole
 * reason the note lanes can scroll smoothly off a channel that only speaks
 * thirty times a second. These are the rules that extrapolation has to obey.
 */
describe('the audience clock extrapolates the host anchor in real time', () => {
  it('runs the song forward by exactly the wall time since the anchor was taken', () => {
    const playback = anchor()
    expect(playbackPositionMs(playback, playback.atEpochMs)).toBe(30000)
    expect(playbackPositionMs(playback, playback.atEpochMs + 500)).toBe(30500)
    // Half a second on from a 34ms-coalesced message: without this, the lane
    // would sit still between payloads and jump when one arrived.
    expect(playbackBeat(playback, META, playback.atEpochMs + 500)).toBeCloseTo(
      msToBeat(30500, META.bpm, META.gap),
      6,
    )
  })

  it('does not run a paused host forward', () => {
    // The host pauses (a countdown, the end of the song); the audience must
    // stop where the host stopped rather than scrolling on past the last note.
    const playback = anchor({ paused: true })
    expect(playbackPositionMs(playback, playback.atEpochMs + 5000)).toBe(30000)
  })

  it('never runs the song backwards when the wall clock steps back', () => {
    // Date.now() is the only clock the two renderer processes share, and it is
    // not monotonic -- an NTP correction mid-song must not rewind the lane.
    const playback = anchor()
    expect(playbackPositionMs(playback, playback.atEpochMs - 250)).toBe(30000)
  })
})
