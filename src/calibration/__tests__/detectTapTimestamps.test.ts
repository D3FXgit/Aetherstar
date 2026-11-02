import { describe, expect, it } from 'vitest'
import { detectTapTimestamps } from '../detectTapTimestamps'
import type { PitchSample } from '../../contracts/types'

function sample(t: number, confidence: number): PitchSample {
  return { t, hz: 220, confidence, deviceId: 'dev-1' }
}

describe('detectTapTimestamps', () => {
  it('returns no taps when confidence never rises', () => {
    const samples = [sample(0, 0.05), sample(10, 0.05), sample(20, 0.05)]
    expect(detectTapTimestamps(samples)).toEqual([])
  })

  it('detects one tap at the sample where confidence rises above the threshold', () => {
    const samples = [sample(0, 0.05), sample(10, 0.05), sample(20, 0.9), sample(30, 0.9)]
    expect(detectTapTimestamps(samples)).toEqual([20])
  })

  it('detects two taps separated by more than the refractory window', () => {
    const samples = [
      sample(0, 0.05),
      sample(10, 0.9), // tap 1
      sample(20, 0.05),
      sample(500, 0.05),
      sample(510, 0.9), // tap 2, well past the 200ms default refractory window
    ]
    expect(detectTapTimestamps(samples)).toEqual([10, 510])
  })

  it('debounces a second high-confidence sample inside the refractory window', () => {
    const samples = [
      sample(0, 0.05),
      sample(10, 0.9), // tap 1
      sample(20, 0.9), // still within the refractory window -- not a second tap
      sample(30, 0.05),
    ]
    expect(detectTapTimestamps(samples)).toEqual([10])
  })

  it('honors an explicit confidenceThreshold', () => {
    const samples = [sample(0, 0.3), sample(100, 0.3)]
    expect(detectTapTimestamps(samples, 0.5)).toEqual([])
    expect(detectTapTimestamps(samples, 0.2)).toEqual([0])
  })

  it('honors an explicit refractoryMs for two dipped-and-risen taps', () => {
    const samples = [sample(0, 0.9), sample(10, 0.05), sample(30, 0.9)]
    expect(detectTapTimestamps(samples, 0.5, 200)).toEqual([0]) // 30ms since last tap < default-style 200ms window
    expect(detectTapTimestamps(samples, 0.5, 20)).toEqual([0, 30])
  })

  // The pitch worker emits nothing for unvoiced frames, so between two taps
  // there are usually no samples at all -- only a hole in the timeline.
  it('treats a gap of more than ~60 ms between samples as a falling edge', () => {
    const samples = [
      sample(0, 0.9), // tap 1
      sample(10, 0.9),
      sample(20, 0.9),
      // silence: no samples between 20 and 400
      sample(400, 0.9), // tap 2 -- no low-confidence sample in between
      sample(410, 0.9),
    ]
    expect(detectTapTimestamps(samples)).toEqual([0, 400])
  })

  it('does not split one sustained sound over a short gap (a late or dropped frame)', () => {
    const samples = [sample(0, 0.9), sample(10, 0.9), sample(50, 0.9), sample(300, 0.05)]
    expect(detectTapTimestamps(samples)).toEqual([0])
  })

  it('still applies the refractory window after a gap', () => {
    const samples = [sample(0, 0.9), sample(100, 0.9)]
    expect(detectTapTimestamps(samples)).toEqual([0]) // 100 ms < 200 ms refractory
    expect(detectTapTimestamps(samples, 0.5, 50)).toEqual([0, 100])
  })

  it('honors an explicit maxGapMs', () => {
    const samples = [sample(0, 0.9), sample(300, 0.9)]
    expect(detectTapTimestamps(samples, 0.5, 200, 500)).toEqual([0])
    expect(detectTapTimestamps(samples, 0.5, 200, 60)).toEqual([0, 300])
  })
})
