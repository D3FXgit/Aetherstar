import { describe, expect, it } from 'vitest'
import { createClockBuffer, CLOCK_BUFFER_WINDOW_MS } from '../reconcileClock'

describe('createClockBuffer', () => {
  it('returns null before any record() call', () => {
    const buffer = createClockBuffer()
    expect(buffer.beatAt(1000)).toBeNull()
  })

  it('returns a recorded beat exactly, for a timestamp it holds', () => {
    const buffer = createClockBuffer()
    buffer.record(1000, 4)
    buffer.record(1010, 4.2)
    buffer.record(1020, 4.4)

    expect(buffer.beatAt(1010)).toBeCloseTo(4.2, 6)
  })

  /**
   * The beat position is a linear function of time, so a sample that landed
   * between two frames belongs between their two beats. Snapping it to the
   * nearer frame threw away up to half a frame of timing accuracy on every
   * judged sample -- 4ms at 120Hz, 8ms at 60Hz, and more whenever a frame is
   * dropped.
   */
  it('interpolates linearly between the two frames a sample fell between', () => {
    const buffer = createClockBuffer()
    buffer.record(1000, 4)
    buffer.record(1010, 4.2)

    expect(buffer.beatAt(1002)).toBeCloseTo(4.04, 6)
    expect(buffer.beatAt(1005)).toBeCloseTo(4.1, 6)
  })

  /**
   * The regression this buffer's whole existence depends on.
   *
   * `beatAt` used to return the *closest* recorded entry with no bound at all,
   * so a pitch sample from ten seconds ago reconciled to the oldest beat still
   * in the buffer. Gameplay hands judgeNote every sample captured since the
   * previous note ended -- which, before the first note of a song with a
   * 38-second #GAP, is half a minute of them. Every one of those was snapped
   * into the buffer's window and, if that beat happened to fall inside the
   * note being judged, counted as if it had been sung during the note.
   */
  it('returns null past its memory horizon instead of snapping a stale sample into the current window', () => {
    const buffer = createClockBuffer(250)
    buffer.record(1000, 4)
    buffer.record(1260, 5) // 260ms later -- evicts the t=1000 entry

    // A whole song's worth of backlog: nowhere near anything this buffer saw.
    expect(buffer.beatAt(-30_000)).toBeNull()
    expect(buffer.beatAt(900)).toBeNull()
    expect(buffer.beatAt(1260)).toBeCloseTo(5, 6)
  })

  it('tolerates a sample timestamped a hair after the newest frame, but not a whole frame after', () => {
    const buffer = createClockBuffer()
    buffer.record(1000, 4)
    buffer.record(1010, 4.2)

    expect(buffer.beatAt(1015)).toBeCloseTo(4.2, 6)
    expect(buffer.beatAt(1010 + 500)).toBeNull()
  })

  /**
   * The default window has to outlast a whole note, because that is the span
   * judgeNote reconciles at once. At 250ms it could not: a 24-beat note in the
   * repo's own fixture chart lasts 1440ms, so most of its samples fell off the
   * back of the buffer before the note was judged.
   */
  it('defaults to a window long enough to cover a real note', () => {
    expect(CLOCK_BUFFER_WINDOW_MS).toBeGreaterThanOrEqual(2000)

    const buffer = createClockBuffer()
    buffer.record(0, 0)
    buffer.record(1440, 24)
    expect(buffer.beatAt(720)).toBeCloseTo(12, 6)
  })

  /**
   * 2000ms only covered the repo's own fixture chart, which is BPM 250. An
   * UltraStar `#BPM` counts quarter beats, so a beat is `60000/(bpm*4)` ms and
   * the same 24-beat hold that runs 1440ms there runs 3600ms at BPM 100 -- an
   * entirely ordinary tag value. Past the window those samples are simply
   * dropped by judgeNote, so a long note was silently judged on its last two
   * and a half seconds only.
   */
  it('covers a long hold at a slow chart BPM, not just the fixture chart', () => {
    const msPerBeatAt = (bpm: number) => 60000 / (bpm * 4)
    const longHoldMs = 24 * msPerBeatAt(100) // 3600ms
    expect(CLOCK_BUFFER_WINDOW_MS).toBeGreaterThanOrEqual(longHoldMs)

    const buffer = createClockBuffer()
    for (let beat = 0; beat <= 24; beat += 0.25) buffer.record(beat * msPerBeatAt(100), beat)

    // The very first sample of the hold still reconciles, rather than falling
    // off the back of the buffer before the note is judged at its end.
    expect(buffer.beatAt(0)).toBeCloseTo(0, 6)
    expect(buffer.beatAt(longHoldMs / 2)).toBeCloseTo(12, 6)
  })

  /**
   * The window must stay well below a song's #GAP. The out-of-window rejection
   * is the only thing stopping the whole pre-first-note backlog Gameplay
   * carries (20-40 seconds of it for a typical chart) from being snapped onto
   * the first note's span -- so widening it for long notes must not widen it
   * far enough to swallow the gap.
   */
  it('still rejects a sample from before a typical song #GAP', () => {
    const buffer = createClockBuffer()
    buffer.record(24_065, 0) // the fixture chart's own #GAP
    buffer.record(24_125, 1)

    expect(CLOCK_BUFFER_WINDOW_MS).toBeLessThan(20_000)
    expect(buffer.beatAt(1000)).toBeNull()
  })

  it('keeps the buffer bounded rather than growing for the length of a song', () => {
    const buffer = createClockBuffer(1000)
    for (let i = 0; i < 20_000; i++) buffer.record(i * 8, i)
    expect(buffer.size()).toBeLessThanOrEqual(1000 / 8 + 2)
  })
})

/**
 * `timeAt` -- the inverse lookup partial credit needs.
 *
 * `beatAt` answers "when the singer made this sound, where was the song?".
 * This answers "when did this note start and end?", which is the denominator
 * of coverage: the fraction of a note's *duration* that was sung. A duration
 * cannot be got from beats without a tempo, and the buffer already holds the
 * tempo implicitly as the slope of its (t, beat) pairs.
 */
describe('createClockBuffer.timeAt', () => {
  function buffer60fpsFrom(startT: number, startBeat: number, frames: number, beatsPerFrame: number) {
    const buffer = createClockBuffer()
    for (let i = 0; i < frames; i += 1) buffer.record(startT + i * 16, startBeat + i * beatsPerFrame)
    return buffer
  }

  it('returns null before any record() call', () => {
    expect(createClockBuffer().timeAt(4)).toBeNull()
  })

  it('returns the exact timestamp of a beat it recorded', () => {
    const buffer = buffer60fpsFrom(1000, 4, 10, 0.25)
    expect(buffer.timeAt(4)).toBe(1000)
    expect(buffer.timeAt(5)).toBe(1064)
  })

  it('interpolates a beat that fell between two frames', () => {
    const buffer = createClockBuffer()
    buffer.record(1000, 4)
    buffer.record(1016, 5)
    expect(buffer.timeAt(4.5)).toBeCloseTo(1008, 6)
  })

  it('round-trips against beatAt, which is the property the two share', () => {
    const buffer = buffer60fpsFrom(5000, 12, 40, 0.4)
    for (const beat of [12.3, 14, 18.75, 23.2]) {
      expect(buffer.beatAt(buffer.timeAt(beat)!)).toBeCloseTo(beat, 6)
    }
  })

  /**
   * Deliberately strict at both ends, exactly as `beatAt` is.
   *
   * Clamping a beat the buffer never observed to its nearest edge would shorten
   * the note's measured span, which inflates coverage -- silently, and in the
   * singer's favour, which is the direction a scoring bug is hardest to notice.
   * A caller that gets null has to decide what it does instead (judgeNote falls
   * back to the fraction of the evidence, and says so).
   */
  it('refuses a beat outside the range it has actually seen', () => {
    const buffer = buffer60fpsFrom(1000, 4, 10, 0.25)
    expect(buffer.timeAt(3.9)).toBeNull()
    expect(buffer.timeAt(100)).toBeNull()
  })

  it('refuses to invert a clock that has not moved', () => {
    const buffer = createClockBuffer()
    for (let i = 0; i < 10; i += 1) buffer.record(1000 + i * 16, 4) // paused playback
    expect(buffer.timeAt(4)).toBeNull()
  })

  it('places a whole note the way judging actually asks it to', () => {
    // 250 BPM in UltraStar quarter-beats -> 60ms per beat. A 4-beat note.
    const buffer = createClockBuffer()
    for (let ms = 0; ms <= 1000; ms += 16) buffer.record(10_000 + ms, ms / 60)
    const start = buffer.timeAt(4)!
    const end = buffer.timeAt(8)!
    expect(end - start).toBeCloseTo(240, 0)
  })
})
