import { describe, expect, it } from 'vitest'
import {
  kWeightingFilters,
  measureAudioBufferLoudness,
  measureIntegratedLoudness,
  SAMPLE_PEAK_MARGIN_DB,
  type MeasurableBuffer,
} from '../loudnessMeter'

function sine(frequency: number, amplitude: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  return out
}

function bufferOf(channels: Float32Array[], sampleRate: number): MeasurableBuffer {
  return { sampleRate, numberOfChannels: channels.length, length: channels[0].length, getChannelData: (c) => channels[c] }
}

describe('kWeightingFilters', () => {
  it('reproduces the BS.1770 table coefficients at 48 kHz', () => {
    const [shelf, highPass] = kWeightingFilters(48_000)
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 8)
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 8)
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 8)
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 8)
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 8)
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 8)
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 8)
  })
})

describe('measureIntegratedLoudness', () => {
  it('reads the EBU reference tone: a stereo 1 kHz sine at -23 dBFS is -23 LUFS', () => {
    const amplitude = 10 ** (-23 / 20)
    const tone = sine(1000, amplitude, 10, 48_000)
    const result = measureIntegratedLoudness([tone, tone], 48_000)
    expect(result?.integratedLufs).toBeCloseTo(-23, 1)
  })

  it('gives the same answer at 44.1 kHz, the rate most song files use', () => {
    const amplitude = 10 ** (-23 / 20)
    const tone = sine(1000, amplitude, 10, 44_100)
    expect(measureIntegratedLoudness([tone, tone], 44_100)?.integratedLufs).toBeCloseTo(-23, 1)
  })

  it('gates out silence, so a quiet intro does not drag a song down', () => {
    const sampleRate = 48_000
    const amplitude = 10 ** (-20 / 20)
    const tone = sine(1000, amplitude, 8, sampleRate)
    const withSilence = new Float32Array(tone.length * 2)
    withSilence.set(tone, tone.length)
    const plain = measureIntegratedLoudness([tone, tone], sampleRate)!.integratedLufs
    const gated = measureIntegratedLoudness([withSilence, withSilence], sampleRate)!.integratedLufs
    // Only the few blocks straddling the edge differ; the 8 s of silence itself counts for nothing.
    expect(Math.abs(gated - plain)).toBeLessThan(0.2)
  })

  it('reports the peak with a safety margin for inter-sample overs', () => {
    const tone = sine(1000, 0.5, 2, 48_000)
    const result = measureIntegratedLoudness([tone], 48_000)!
    expect(result.truePeakDbtp).toBeCloseTo(20 * Math.log10(0.5) + SAMPLE_PEAK_MARGIN_DB, 1)
  })

  it('returns null for silence and for audio shorter than one gating block', () => {
    expect(measureIntegratedLoudness([new Float32Array(48_000 * 3)], 48_000)).toBeNull()
    expect(measureIntegratedLoudness([sine(1000, 0.5, 0.2, 48_000)], 48_000)).toBeNull()
    expect(measureIntegratedLoudness([], 48_000)).toBeNull()
  })
})

describe('measureAudioBufferLoudness', () => {
  it('matches the one-shot measurement while yielding between slices', async () => {
    const amplitude = 10 ** (-18 / 20)
    const tone = sine(440, amplitude, 12, 48_000)
    let yields = 0
    const sliced = await measureAudioBufferLoudness(bufferOf([tone, tone], 48_000), {
      sliceSeconds: 1,
      yieldFn: async () => {
        yields++
      },
    })
    const whole = measureIntegratedLoudness([tone, tone], 48_000)
    expect(yields).toBeGreaterThan(5)
    expect(sliced!.integratedLufs).toBeCloseTo(whole!.integratedLufs, 6)
  })

  it('returns null for an empty buffer instead of throwing', async () => {
    await expect(measureAudioBufferLoudness(bufferOf([new Float32Array(0)], 48_000))).resolves.toBeNull()
  })
})