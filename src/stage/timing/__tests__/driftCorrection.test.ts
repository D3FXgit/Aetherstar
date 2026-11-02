import { describe, expect, it } from 'vitest'
import {
  computeVideoPlaybackRate,
  createVideoSeekTracker,
  MAX_FAILED_VIDEO_SEEKS,
  RATE_DEADBAND_MS,
  RATE_QUANTUM,
  shouldHardSeekVideo,
  videoSeekTargetSec,
  videoTargetMs,
} from '../driftCorrection'

describe('computeVideoPlaybackRate', () => {
  it('returns 1 (no nudge) when audio and video are in sync', () => {
    expect(computeVideoPlaybackRate({ audioMs: 1000, videoMs: 1000, videoGapMs: 0 })).toBe(1)
  })

  it('nudges the rate above 1 when video is behind audio', () => {
    const rate = computeVideoPlaybackRate({ audioMs: 1200, videoMs: 1000, videoGapMs: 0 })
    expect(rate).toBeGreaterThan(1)
  })

  it('nudges the rate below 1 when video is ahead of audio', () => {
    const rate = computeVideoPlaybackRate({ audioMs: 1000, videoMs: 1200, videoGapMs: 0 })
    expect(rate).toBeLessThan(1)
  })

  it('clamps extreme desync to within [0.95, 1.05]', () => {
    const behind = computeVideoPlaybackRate({ audioMs: 3000, videoMs: 1000, videoGapMs: 0 })
    const ahead = computeVideoPlaybackRate({ audioMs: 1000, videoMs: 3000, videoGapMs: 0 })
    expect(behind).toBeLessThanOrEqual(1.05)
    expect(ahead).toBeGreaterThanOrEqual(0.95)
  })

  it('leaves the rate alone inside the deadband', () => {
    expect(computeVideoPlaybackRate({ audioMs: 1000 + RATE_DEADBAND_MS, videoMs: 1000, videoGapMs: 0 })).toBe(1)
    expect(computeVideoPlaybackRate({ audioMs: 1000, videoMs: 1000 + RATE_DEADBAND_MS, videoGapMs: 0 })).toBe(1)
  })

  it('quantises the rate, so a jittering desync does not write a new rate every frame', () => {
    for (const desync of [37, 61, 133, 487, -91, -222]) {
      const rate = computeVideoPlaybackRate({ audioMs: 1000 + desync, videoMs: 1000, videoGapMs: 0 })
      expect(Math.abs(rate / RATE_QUANTUM - Math.round(rate / RATE_QUANTUM))).toBeLessThan(1e-9)
    }
    expect(computeVideoPlaybackRate({ audioMs: 1101, videoMs: 1000, videoGapMs: 0 })).toBe(
      computeVideoPlaybackRate({ audioMs: 1104, videoMs: 1000, videoGapMs: 0 }),
    )
  })
})

/**
 * UltraStar Deluxe shows the video frame at audio + #VIDEOGAP: a positive gap
 * means the video's own intro is skipped. This used to be audio - gap.
 */
describe('#VIDEOGAP', () => {
  it('puts the video *ahead* of the audio by a positive gap', () => {
    expect(videoTargetMs(0, 1500)).toBe(1500)
    expect(videoTargetMs(10_000, 1500)).toBe(11_500)
  })

  it('holds a negative-gap video before its start', () => {
    expect(videoTargetMs(1000, -2000)).toBe(-1000)
    expect(videoSeekTargetSec(-1000, 60)).toBeNull()
  })

  it('treats a video sitting at audio + gap as in sync', () => {
    expect(computeVideoPlaybackRate({ audioMs: 10_000, videoMs: 11_500, videoGapMs: 1500 })).toBe(1)
    // The old sign would have called this 3 s out.
    expect(computeVideoPlaybackRate({ audioMs: 10_000, videoMs: 8_500, videoGapMs: 1500 })).toBeGreaterThan(1)
  })

  it('never seeks at or past the end of the video', () => {
    expect(videoSeekTargetSec(59_000, 60)).toBe(59)
    expect(videoSeekTargetSec(60_000, 60)).toBeNull()
    expect(videoSeekTargetSec(75_000, 60)).toBeNull()
    expect(videoSeekTargetSec(75_000, Number.NaN)).toBe(75)
  })
})

describe('hard video seeks', () => {
  const base = { src: 'a.mp4', seeking: false, canSeek: true, thresholdMs: 250, minIntervalMs: 800 }

  it('seeks a large desync, but not more often than the interval', () => {
    const tracker = createVideoSeekTracker()
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 600, nowMs: 1_000 })).toBe(true)
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 600, nowMs: 1_100 })).toBe(false)
  })

  it('never seeks a small desync, a seeking element or an unready one', () => {
    const tracker = createVideoSeekTracker()
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 100, nowMs: 1_000 })).toBe(false)
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 600, nowMs: 1_000, seeking: true })).toBe(false)
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 600, nowMs: 1_000, canSeek: false })).toBe(false)
  })

  it(`stops hard-seeking a source after ${MAX_FAILED_VIDEO_SEEKS} seeks that did not land`, () => {
    const tracker = createVideoSeekTracker()
    let now = 0
    let seeks = 0
    for (let attempt = 0; attempt < 10; attempt += 1) {
      now += 1_000
      if (shouldHardSeekVideo(tracker, { ...base, desyncMs: 900, nowMs: now })) seeks += 1
    }
    expect(seeks).toBe(MAX_FAILED_VIDEO_SEEKS)
  })

  it('forgives a source whose seek landed, and starts over for a new source', () => {
    const tracker = createVideoSeekTracker()
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 900, nowMs: 1_000 })).toBe(true)
    // Landed: in step on the next look.
    expect(shouldHardSeekVideo(tracker, { ...base, desyncMs: 10, nowMs: 2_000 })).toBe(false)
    expect(tracker.failures).toBe(0)

    tracker.failures = MAX_FAILED_VIDEO_SEEKS
    expect(shouldHardSeekVideo(tracker, { ...base, src: 'b.mp4', desyncMs: 900, nowMs: 3_000 })).toBe(true)
  })
})
