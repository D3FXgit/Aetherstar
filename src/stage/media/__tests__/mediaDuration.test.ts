import { describe, expect, it } from 'vitest'
import { mediaDurationSec } from '../mediaDuration'

function ranges(...spans: [number, number][]): TimeRanges {
  return {
    length: spans.length,
    start: (index: number) => spans[index][0],
    end: (index: number) => spans[index][1],
  } as TimeRanges
}

function element({
  duration = NaN,
  seekable = ranges(),
  buffered = ranges(),
  networkState = 0,
}: {
  duration?: number
  seekable?: TimeRanges
  buffered?: TimeRanges
  networkState?: number
}) {
  return { duration, seekable, buffered, networkState } as unknown as HTMLMediaElement
}

describe('mediaDurationSec', () => {
  it('is the element duration when it is a real length', () => {
    expect(mediaDurationSec(element({ duration: 48.5 }))).toBe(48.5)
  })

  it('is unknown with no element, or before the metadata is in', () => {
    expect(mediaDurationSec(null)).toBeNull()
    expect(mediaDurationSec(element({ duration: NaN }))).toBeNull()
    expect(mediaDurationSec(element({ duration: 0 }))).toBeNull()
  })

  it('reads a stream-like source (duration Infinity) by how far it can seek', () => {
    expect(mediaDurationSec(element({ duration: Infinity, seekable: ranges([0, 48.5]) }))).toBe(48.5)
  })

  it('reads a fully loaded stream-like source by what it has buffered', () => {
    const loaded = element({ duration: Infinity, buffered: ranges([0, 48.5]), networkState: 1 })
    expect(mediaDurationSec(loaded)).toBe(48.5)
  })

  it('does not take a still-loading buffer for the length', () => {
    expect(mediaDurationSec(element({ duration: Infinity, buffered: ranges([0, 12]), networkState: 2 }))).toBeNull()
    expect(mediaDurationSec(element({ duration: Infinity, buffered: ranges([0, 12], [20, 30]), networkState: 1 }))).toBeNull()
  })

  it('is unknown when nothing about the source has a finite end', () => {
    expect(mediaDurationSec(element({ duration: Infinity, seekable: ranges([0, Infinity]) }))).toBeNull()
  })
})
