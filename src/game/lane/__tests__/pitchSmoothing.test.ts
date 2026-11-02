import { describe, expect, it } from 'vitest'
import {
  lerpTowards,
  PITCH_LERP_TIME_CONSTANT_MS,
  snapThresholdSemitones,
  snapToTarget,
} from '../pitchSmoothing'
import { matchPitch, snapWindowSemitones } from '../../matching/hzToPitchClass'

describe('snapToTarget -- pitch magnetism', () => {
  it('pulls a nearly-right pitch dead-centre onto the note', () => {
    expect(snapToTarget(60.4, 60)).toBe(60)
    expect(snapToTarget(59.6, 60)).toBe(60)
  })

  it('snaps right up to the threshold, and stops the moment it is passed', () => {
    const threshold = snapThresholdSemitones()
    expect(snapToTarget(60 + threshold, 60, threshold)).toBe(60)
    expect(snapToTarget(60 - threshold, 60, threshold)).toBe(60)
    expect(snapToTarget(60 + threshold + 0.01, 60, threshold)).toBeCloseTo(60 + threshold + 0.01, 5)
  })

  /**
   * The line has to keep telling the truth. A singer who is genuinely on the
   * wrong note must be shown on the wrong note -- an indicator that snapped to
   * whatever was nearest would say "you are on it" while the score said
   * otherwise, which is worse than no indicator at all.
   */
  it('leaves a genuinely wrong note exactly where it was sung', () => {
    expect(snapToTarget(64, 60)).toBe(64)
    expect(snapToTarget(56.5, 60)).toBe(56.5)
  })

  /**
   * The snap window IS the judge's tolerance window, not a wider number of its
   * own: a wider one draws a missed note dead centre on the note. Difficulty
   * moves both the same way.
   */
  it('is exactly the window the judge rounds into tolerance, per difficulty', () => {
    expect(snapThresholdSemitones()).toBe(snapWindowSemitones(1))
    expect(snapThresholdSemitones(2)).toBe(snapWindowSemitones(2))
    expect(snapThresholdSemitones(0)).toBe(snapWindowSemitones(0))
  })

  it('does not draw a note that scores AWFUL as dead centre', () => {
    // 160 cents rounds to 2 semitones: outside Normal's 1-semitone tolerance.
    const semitonesOff = 160 / 100
    expect(matchPitch(440 * Math.pow(2, semitonesOff / 12), 9).tier).toBe('awful')
    expect(snapToTarget(60 + semitonesOff, 60, snapThresholdSemitones())).toBeCloseTo(60 + semitonesOff, 5)
  })

  it('does nothing when there is no note to snap to', () => {
    expect(snapToTarget(60.4, null)).toBe(60.4)
    expect(snapToTarget(60.4, Number.NaN)).toBe(60.4)
  })

  it('never turns a non-finite reading into a number that looks real', () => {
    expect(snapToTarget(Number.NaN, 60)).toBeNaN()
  })
})

describe('lerpTowards -- frame-rate independence', () => {
  /**
   * The bug this exists to prevent, stated as a test.
   *
   * A fixed per-frame factor (`current + (target - current) * 0.2`) is a
   * *different filter at every refresh rate*: over 100ms it closes 67% of the
   * gap at 60Hz and 89% at 120Hz. This app is developed on a 120Hz panel and
   * played on 60Hz televisions, so that difference is the difference between
   * "smooth" and "twitchy" depending on whose living room it is in.
   */
  function simulate(totalMs: number, frameMs: number): number {
    let value = 0
    for (let elapsed = 0; elapsed < totalMs - 1e-9; elapsed += frameMs) {
      value = lerpTowards(value, 100, frameMs)
    }
    return value
  }

  it('lands in the same place after 100ms whether the display runs at 60, 120 or 240Hz', () => {
    const at60 = simulate(100, 1000 / 60)
    const at120 = simulate(100, 1000 / 120)
    const at240 = simulate(100, 1000 / 240)

    expect(at120).toBeCloseTo(at60, 1)
    expect(at240).toBeCloseTo(at60, 1)
  })

  it('closes about 63% of the gap in one time constant, by construction', () => {
    expect(lerpTowards(0, 100, PITCH_LERP_TIME_CONSTANT_MS)).toBeCloseTo(63.2, 0)
  })

  /**
   * A dropped frame is the same case in disguise: one 33ms frame has to move
   * exactly as far as the two 16.5ms frames it replaced, or a hitch shows up
   * as the pitch line visibly lagging and then lurching.
   */
  it('moves a long frame exactly as far as the two short frames it replaced', () => {
    const twoShort = lerpTowards(lerpTowards(0, 100, 16.5), 100, 16.5)
    const oneLong = lerpTowards(0, 100, 33)
    expect(oneLong).toBeCloseTo(twoShort, 8)
  })

  it('approaches the target without ever overshooting it', () => {
    let value = 0
    for (let i = 0; i < 500; i += 1) {
      value = lerpTowards(value, 100, 8)
      expect(value).toBeLessThanOrEqual(100)
    }
    expect(value).toBeCloseTo(100, 3)
  })

  it('works the same way downward', () => {
    expect(lerpTowards(100, 0, PITCH_LERP_TIME_CONSTANT_MS)).toBeCloseTo(36.8, 0)
  })

  it('moves nothing on a zero-length or negative frame', () => {
    expect(lerpTowards(10, 100, 0)).toBe(10)
    expect(lerpTowards(10, 100, -5)).toBe(10)
  })

  it('degrades to an instant jump when smoothing is switched off', () => {
    expect(lerpTowards(10, 100, 16, 0)).toBe(100)
  })

  it('never propagates a non-finite value into the indicator', () => {
    expect(lerpTowards(10, Number.NaN, 16)).toBe(10)
    expect(lerpTowards(Number.NaN, 100, 16)).toBe(100)
  })

  // Short enough that a deliberate jump between two notes lands inside a
  // sixteenth note at any singable tempo; long enough to absorb the detector's
  // frame-to-frame wander, which is the entire reason this exists.
  it('settles fast enough to follow a real note change', () => {
    expect(lerpTowards(0, 100, 165)).toBeGreaterThan(95)
  })
})
