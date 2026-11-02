import { describe, expect, it } from 'vitest'
import { channelLabel, channelLabels } from '../channelLabels'

describe('channelLabels', () => {
  it('offers nothing when no device is chosen', () => {
    expect(channelLabels(0)).toEqual([])
  })

  // "Channel 1" on a mono mic reads as the first of several. "Mono" says there
  // is exactly one input and the empty control is not a loading failure.
  it('names a single-channel device Mono', () => {
    expect(channelLabels(1)).toEqual(['Mono'])
  })

  it('names a stereo pair Left and Right', () => {
    expect(channelLabels(2)).toEqual(['Left', 'Right'])
  })

  // A multi-channel USB interface silkscreens its sockets IN 1, IN 2... so the
  // dropdown says the same thing the hardware does.
  it('numbers a multi-channel interface In 1..In N', () => {
    expect(channelLabels(4)).toEqual(['In 1', 'In 2', 'In 3', 'In 4'])
  })

  it('treats a nonsense channel count as no choice at all rather than throwing', () => {
    expect(channelLabels(-1)).toEqual([])
    expect(channelLabels(Number.NaN)).toEqual([])
  })
})

describe('channelLabel', () => {
  it('names one channel of a device', () => {
    expect(channelLabel(2, 1)).toBe('Right')
  })

  it('falls back to a bare input number for a channel the device does not have', () => {
    expect(channelLabel(2, 5)).toBe('In 6')
  })
})
