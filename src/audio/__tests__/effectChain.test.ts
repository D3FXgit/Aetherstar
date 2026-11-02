import { describe, expect, it, vi } from 'vitest'
import { buildMuffledChain, connectEffect, createRoomImpulse } from '../effectChain'
import { RESULTS_BED_EFFECT, dbToGain } from '../resultsBed'
import type { AudioContextLike, BiquadFilterNodeLike, ConvolverNodeLike, GainNodeLike } from '../webAudioApi'

const SAMPLE_RATE = 8000

function fakeGain(): GainNodeLike {
  return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() }
}

function fakeBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length))
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => data[channel],
  } as unknown as AudioBuffer
}

/** A context with every node the chain can use (`full`), or only the minimal gain/source pair. */
function fakeContext(full: boolean) {
  const gains: GainNodeLike[] = []
  const filters: BiquadFilterNodeLike[] = []
  const convolvers: ConvolverNodeLike[] = []
  const context: AudioContextLike = {
    currentTime: 0,
    state: 'running',
    destination: { name: 'destination' },
    createGain: vi.fn(() => {
      const node = fakeGain()
      gains.push(node)
      return node
    }),
    createBufferSource: vi.fn(),
    decodeAudioData: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
  }
  if (full) {
    Object.assign(context, {
      sampleRate: SAMPLE_RATE,
      createBiquadFilter: vi.fn(() => {
        const node: BiquadFilterNodeLike = {
          type: 'lowpass',
          frequency: { value: 350 },
          Q: { value: 1 },
          gain: { value: 0 },
          connect: vi.fn(),
        }
        filters.push(node)
        return node
      }),
      createConvolver: vi.fn(() => {
        const node: ConvolverNodeLike = { buffer: null, normalize: false, connect: vi.fn() }
        convolvers.push(node)
        return node
      }),
      createBuffer: vi.fn(fakeBuffer),
    })
  }
  return { context, gains, filters, convolvers }
}

describe('the muffled effect chain', () => {
  it('is a lowpass and a high-shelf cut into a dry/wet split with a room convolver, at the configured values', () => {
    const { context } = fakeContext(true)
    const output = { name: 'bus' }

    const chain = buildMuffledChain(context, output)

    expect(chain.input).toBe(chain.lowpass)
    expect(chain.lowpass).toMatchObject({ type: 'lowpass' })
    expect(chain.lowpass!.frequency.value).toBe(RESULTS_BED_EFFECT.lowpassHz)
    expect(chain.lowpass!.Q.value).toBe(RESULTS_BED_EFFECT.lowpassQ)
    expect(chain.highShelf).toMatchObject({ type: 'highshelf' })
    expect(chain.highShelf!.frequency.value).toBe(RESULTS_BED_EFFECT.highShelfHz)
    expect(chain.highShelf!.gain.value).toBe(RESULTS_BED_EFFECT.highShelfDb)
    expect(chain.lowpass!.connect).toHaveBeenCalledWith(chain.highShelf)

    // Fan-out from the end of the filters into both paths.
    expect(chain.highShelf!.connect).toHaveBeenCalledWith(chain.dry)
    expect(chain.highShelf!.connect).toHaveBeenCalledWith(chain.convolver)
    expect(chain.convolver!.normalize).toBe(true)
    expect(chain.convolver!.buffer).not.toBeNull()
    expect(chain.convolver!.connect).toHaveBeenCalledWith(chain.wet)
    expect(chain.wet!.gain.value).toBe(RESULTS_BED_EFFECT.wet)
    expect(chain.dry.gain.value).toBe(RESULTS_BED_EFFECT.dry)

    // Both paths sum into the level node, which is the only thing on the bus.
    expect(chain.wet!.connect).toHaveBeenCalledWith(chain.level)
    expect(chain.dry.connect).toHaveBeenCalledWith(chain.level)
    expect(chain.level.gain.value).toBeCloseTo(dbToGain(RESULTS_BED_EFFECT.levelDb), 9)
    expect(chain.level.connect).toHaveBeenCalledWith(output)
  })

  it('sits 4-8 dB under the normal level, with a gentle lowpass in the 600-900 Hz range', () => {
    expect(RESULTS_BED_EFFECT.levelDb).toBeGreaterThanOrEqual(-8)
    expect(RESULTS_BED_EFFECT.levelDb).toBeLessThanOrEqual(-4)
    expect(RESULTS_BED_EFFECT.lowpassHz).toBeGreaterThanOrEqual(600)
    expect(RESULTS_BED_EFFECT.lowpassHz).toBeLessThanOrEqual(900)
    expect(RESULTS_BED_EFFECT.lowpassQ).toBeLessThanOrEqual(1)
    expect(RESULTS_BED_EFFECT.wet + RESULTS_BED_EFFECT.dry).toBeCloseTo(1, 9)
  })

  it('reuses one impulse per context rather than regenerating the noise for every track', () => {
    const { context, convolvers } = fakeContext(true)
    buildMuffledChain(context, {})
    buildMuffledChain(context, {})

    expect(context.createBuffer).toHaveBeenCalledOnce()
    expect(convolvers[0].buffer).toBe(convolvers[1].buffer)
  })

  it('degrades on a reduced context: no filters or room, but still the reduced level, never an error', () => {
    const { context } = fakeContext(false)
    const output = {}

    const chain = buildMuffledChain(context, output)

    expect(chain.lowpass).toBeNull()
    expect(chain.convolver).toBeNull()
    // The dry path carries the full mix on its own, then the level.
    expect(chain.dry.gain.value).toBeCloseTo(RESULTS_BED_EFFECT.dry + RESULTS_BED_EFFECT.wet, 9)
    expect((chain.input as GainNodeLike).connect).toHaveBeenCalledWith(chain.dry)
    expect(chain.level.gain.value).toBeCloseTo(dbToGain(RESULTS_BED_EFFECT.levelDb), 9)
    expect(chain.level.connect).toHaveBeenCalledWith(output)
  })

  it('connectEffect: no effect is the output itself; a context that throws plays dry', () => {
    const { context } = fakeContext(true)
    const output = {}
    expect(connectEffect(context, undefined, output)).toBe(output)

    context.createBiquadFilter = () => {
      throw new Error('not supported')
    }
    expect(connectEffect(context, 'muffled', output)).toBe(output)
  })
})

describe('the room impulse', () => {
  it('is stereo, pre-delayed, decorrelated, and decays exponentially to about -60 dB', () => {
    const { context } = fakeContext(true)
    const impulse = createRoomImpulse(context, 1.5, 12)!

    const preDelay = Math.round(0.012 * SAMPLE_RATE)
    const tail = Math.round(1.5 * SAMPLE_RATE)
    expect(impulse.numberOfChannels).toBe(2)
    expect(impulse.length).toBe(preDelay + tail)

    const left = impulse.getChannelData(0)
    const right = impulse.getChannelData(1)
    expect(left.slice(0, preDelay).every((sample) => sample === 0)).toBe(true)
    expect(Array.from(left.slice(preDelay, preDelay + 32))).not.toEqual(Array.from(right.slice(preDelay, preDelay + 32)))

    const peak = (from: number, to: number) => left.slice(from, to).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    const head = peak(preDelay, preDelay + 400)
    const end = peak(impulse.length - 400, impulse.length)
    expect(head).toBeGreaterThan(0.5)
    expect(end).toBeLessThan(head / 500)
  })

  it('is deterministic: the room sounds the same every time', () => {
    const a = createRoomImpulse(fakeContext(true).context, 0.2, 0)!
    const b = createRoomImpulse(fakeContext(true).context, 0.2, 0)!
    expect(Array.from(a.getChannelData(0))).toEqual(Array.from(b.getChannelData(0)))
  })

  it('is null on a context that cannot make buffers', () => {
    expect(createRoomImpulse(fakeContext(false).context, 1.5, 12)).toBeNull()
  })
})
