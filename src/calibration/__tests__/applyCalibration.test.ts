import { describe, expect, it } from 'vitest'
import { applyCalibration } from '../applyCalibration'
import type { PitchSample } from '../../contracts/types'

function sample(t: number, hz: number): PitchSample {
  return { t, hz, confidence: 1, deviceId: 'dev-1' }
}

describe('applyCalibration', () => {
  it('is the identity transform when the adjustment is null', () => {
    const samples = [sample(1000, 440)]
    expect(applyCalibration(samples, null)).toEqual(samples)
  })

  it('shifts sample.t down by inputOffsetMs', () => {
    const [result] = applyCalibration([sample(1000, 440)], { inputOffsetMs: 50, transpositionSemitones: 0 })
    expect(result.t).toBe(950)
  })

  it('scales sample.hz up by 2^(transpositionSemitones / 12)', () => {
    const [result] = applyCalibration([sample(1000, 440)], { inputOffsetMs: 0, transpositionSemitones: 12 })
    expect(result.hz).toBeCloseTo(880, 5)
  })

  it('composes both adjustments on the same sample', () => {
    const [result] = applyCalibration([sample(1000, 440)], { inputOffsetMs: 50, transpositionSemitones: 12 })
    expect(result.t).toBe(950)
    expect(result.hz).toBeCloseTo(880, 5)
  })
})
