import { describe, expect, it } from 'vitest'
import { readHeapSampleMb } from '../heapSample'

describe('readHeapSampleMb', () => {
  it('converts usedJSHeapSize bytes to MB', () => {
    expect(readHeapSampleMb({ usedJSHeapSize: 52428800 })).toBe(50)
  })

  it('returns null when performance.memory is unavailable (non-Chromium/jsdom)', () => {
    expect(readHeapSampleMb(undefined)).toBeNull()
  })
})
