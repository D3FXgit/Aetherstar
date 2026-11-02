import { describe, expect, it } from 'vitest'
import { applyLoopDeclick } from '../declick'

function makeFakeBuffer(channelData: number[][], sampleRate = 48000): AudioBuffer {
  // Real AudioBuffer.getChannelData() returns the *same* backing array on
  // every call -- mutations persist. Cache per channel so this fake matches.
  const channels = channelData.map((samples) => Float32Array.from(samples))
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0].length,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer
}

describe('applyLoopDeclick', () => {
  it('ramps the first and last N samples toward zero, leaving the middle untouched', () => {
    const samples = Array.from({ length: 20 }, () => 1)
    const buffer = makeFakeBuffer([samples])

    applyLoopDeclick(buffer, 5 / 48000) // exactly 5 fade samples at the default 48000 sample rate

    const data = buffer.getChannelData(0)
    expect(data[0]).toBe(0)
    expect(data[4]).toBeCloseTo(0.8, 5)
    expect(Array.from(data.slice(5, 15))).toEqual(Array(10).fill(1)) // untouched middle
    expect(data[15]).toBeCloseTo(0.8, 5)
    expect(data[19]).toBe(0)
  })

  it('does nothing when fadeSeconds resolves to zero samples', () => {
    const buffer = makeFakeBuffer([[1, 1, 1, 1]])
    applyLoopDeclick(buffer, 0)
    expect(buffer.getChannelData(0)).toEqual(Float32Array.from([1, 1, 1, 1]))
  })

  it('applies the fade independently to every channel', () => {
    const buffer = makeFakeBuffer([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ])
    applyLoopDeclick(buffer, 1) // clamps to half the buffer length per channel

    expect(buffer.getChannelData(0)[0]).toBe(0)
    expect(buffer.getChannelData(1)[0]).toBe(0)
  })

  it('is a no-op against a buffer missing sizing info (test doubles without real Web Audio buffers)', () => {
    const bareBuffer = {} as AudioBuffer
    expect(() => applyLoopDeclick(bareBuffer, 0.015)).not.toThrow()
  })
})
