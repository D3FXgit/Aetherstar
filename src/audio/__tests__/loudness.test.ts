import { describe, expect, it } from 'vitest'
import {
  composeSongVolume,
  computeLoudnessGain,
  dbToGain,
  gainToDb,
  LOUDNESS_TARGET_LUFS,
  MAX_ELEMENT_GAIN,
  MAX_NORMALISATION_DB,
  MAX_NORMALISATION_GAIN,
  MIN_NORMALISATION_DB,
  TRUE_PEAK_CEILING_DBTP,
  UNMEASURED_GAIN_DB,
} from '../loudness'

/** The gain, expressed back in dB, so the assertions read as "this song is pulled down N dB". */
function gainDb(input: Parameters<typeof computeLoudnessGain>[0]): number {
  return gainToDb(computeLoudnessGain(input))
}

describe('computeLoudnessGain', () => {
  it('plays a song with no measurement at the conservative default: not silence, not full blast', () => {
    const fallback = dbToGain(UNMEASURED_GAIN_DB)
    expect(fallback).toBeGreaterThan(0.3)
    expect(fallback).toBeLessThan(1)
    expect(computeLoudnessGain({})).toBeCloseTo(fallback, 10)
    expect(computeLoudnessGain({ loudnessLufs: null, truePeakDbtp: null })).toBeCloseTo(fallback, 10)
    expect(computeLoudnessGain({ loudnessLufs: Number.NaN })).toBeCloseTo(fallback, 10)
  })

  it('clamps normalisation to -20..+12 dB', () => {
    // -1 LUFS wants -17 dB (in range); a -60 LUFS near-silence wants +42 and gets +12.
    expect(gainDb({ loudnessLufs: -1 })).toBeCloseTo(-17, 6)
    expect(gainDb({ loudnessLufs: 10 })).toBeCloseTo(MIN_NORMALISATION_DB, 6)
    expect(gainDb({ loudnessLufs: -60, truePeakDbtp: -40, maxGain: MAX_NORMALISATION_GAIN })).toBeCloseTo(MAX_NORMALISATION_DB, 6)
  })

  it('never boosts a song whose peak is unknown', () => {
    expect(computeLoudnessGain({ loudnessLufs: -24, maxGain: 4 })).toBeCloseTo(1, 10)
  })

  it('pulls a song at the target level to unity', () => {
    expect(computeLoudnessGain({ loudnessLufs: LOUDNESS_TARGET_LUFS })).toBeCloseTo(1, 10)
  })

  it('attenuates a loud master by exactly the difference from target', () => {
    // One very loud master, measured -5.9 LUFS in the real library: 12.1 dB hot.
    expect(gainDb({ loudnessLufs: -5.9 })).toBeCloseTo(-12.1, 6)
    // Lumen Quartet, "Midnight Carousel", measured -14.7 LUFS: 3.3 dB hot.
    expect(gainDb({ loudnessLufs: -14.7 })).toBeCloseTo(-3.3, 6)
  })

  it('collapses the real library spread from ~15 dB to under 3 dB', () => {
    // Every integrated loudness measured by `ffmpeg -af ebur128` over this
    // repo's real 21-song library. This is the regression the whole feature
    // exists for: before, the loudest and quietest song were 14.9 dB apart.
    const measured = [
      -14.7, -6.6, -10.0, -7.4, -6.2, -17.0, -7.9, -17.2, -9.9, -15.1, -20.8, -9.3, -6.2, -14.8, -5.9, -14.7, -18.2,
      -10.2, -9.5, -9.0, -13.4,
    ]
    const before = Math.max(...measured) - Math.min(...measured)
    expect(before).toBeCloseTo(14.9, 6)

    const after = measured.map((loudnessLufs) => loudnessLufs + gainDb({ loudnessLufs }))
    expect(Math.max(...after) - Math.min(...after)).toBeLessThan(3)
    // And nothing was made louder than the target, ever.
    expect(Math.max(...after)).toBeCloseTo(LOUDNESS_TARGET_LUFS, 6)
  })

  it('never returns a gain above the transport ceiling, so an element assignment cannot throw', () => {
    // Liquido, "Narcotic": -20.8 LUFS wants +2.8 dB, which an HTMLMediaElement
    // cannot express. It stays where it is rather than being clamped to silence.
    expect(computeLoudnessGain({ loudnessLufs: -20.8 })).toBe(MAX_ELEMENT_GAIN)
    expect(computeLoudnessGain({ loudnessLufs: -60 })).toBe(1)
  })

  describe('clipping', () => {
    it('limits a boost so the result stays under the true-peak ceiling', () => {
      // A quiet mix that is nonetheless already peaking at -1 dBTP: the loudness
      // target asks for +6 dB, and every one of those dB would clip.
      const gain = computeLoudnessGain({ loudnessLufs: -24, truePeakDbtp: TRUE_PEAK_CEILING_DBTP, maxGain: 4 })
      expect(gain).toBeCloseTo(1, 10)
      expect(-1 + gainToDb(gain)).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP + 1e-9)
    })

    it('allows exactly as much boost as the measured peak headroom permits', () => {
      // -7.2 dBTP leaves 6.2 dB of headroom; the target only asks for 2.8 dB, so
      // the loudness target -- not the peak -- is what binds.
      expect(gainDb({ loudnessLufs: -20.8, truePeakDbtp: -7.2, maxGain: 4 })).toBeCloseTo(2.8, 6)
      // Asking for more headroom than exists is capped at the headroom.
      expect(gainDb({ loudnessLufs: -30, truePeakDbtp: -7.2, maxGain: 4 })).toBeCloseTo(6.2, 6)
    })

    it('never attenuates below the target just because the file itself is already hot', () => {
      // Taio Cruz, "There She Goes": +2.6 dBTP. A naive "keep everything under
      // -1 dBTP" would take another 3.6 dB off it, making it quieter than every
      // other song -- fixing distortion the file already contains and that
      // playing it untouched (what the app does today) does not add to.
      expect(gainDb({ loudnessLufs: -7.4, truePeakDbtp: 2.6 })).toBeCloseTo(-10.6, 6)
      // At the target level with a hot peak, the answer is still unity.
      expect(computeLoudnessGain({ loudnessLufs: LOUDNESS_TARGET_LUFS, truePeakDbtp: 3 })).toBeCloseTo(1, 10)
    })

    it('cannot exceed unity on the element path whatever the inputs say', () => {
      for (const truePeakDbtp of [-20, -6, 0, 3]) {
        for (const loudnessLufs of [-30, -20, -18, -6]) {
          for (const chartVolume of [undefined, 0.5, 1, 4]) {
            expect(computeLoudnessGain({ loudnessLufs, truePeakDbtp, chartVolume })).toBeLessThanOrEqual(1)
          }
        }
      }
    })
  })

  describe('#VOLUME', () => {
    it('stacks on the unmeasured default when the song has never been analysed', () => {
      expect(computeLoudnessGain({ chartVolume: 0.5 })).toBeCloseTo(0.5 * dbToGain(UNMEASURED_GAIN_DB), 10)
    })

    it('multiplies the measurement rather than replacing it, so #VOLUME:1 is a no-op', () => {
      expect(computeLoudnessGain({ loudnessLufs: -6, chartVolume: 1 })).toBeCloseTo(computeLoudnessGain({ loudnessLufs: -6 }), 10)
      expect(gainDb({ loudnessLufs: -12, chartVolume: 0.5 })).toBeCloseTo(-6 + gainToDb(0.5), 6)
    })

    it('ignores a nonsense declaration rather than letting a chart mute itself', () => {
      for (const chartVolume of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(computeLoudnessGain({ loudnessLufs: LOUDNESS_TARGET_LUFS, chartVolume })).toBeCloseTo(1, 10)
      }
    })
  })

  describe('composeSongVolume', () => {
    it('puts the user volume on top of normalisation', () => {
      expect(composeSongVolume(0.5, 0.5)).toBeCloseTo(0.25, 10)
    })

    it('lets a quiet song use the headroom a turned-down slider leaves', () => {
      // +3 dB of normalisation at a -6 dB slider: -3 dB, not capped to the slider.
      expect(gainToDb(composeSongVolume(dbToGain(3), dbToGain(-6)))).toBeCloseTo(-3, 6)
    })

    it('caps the product at the element ceiling and never returns a value an element would throw on', () => {
      expect(composeSongVolume(4, 1)).toBe(MAX_ELEMENT_GAIN)
      expect(composeSongVolume(Number.NaN, 1)).toBe(0)
      expect(composeSongVolume(1, -1)).toBe(0)
    })
  })

  it('dbToGain and gainToDb round-trip', () => {
    for (const db of [-24, -12, -6, 0, 3]) expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 10)
  })
})
