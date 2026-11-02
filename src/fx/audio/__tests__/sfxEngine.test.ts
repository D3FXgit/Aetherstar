import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createSfxEngine, type AudioContextLike } from '../sfxEngine'
import { SFX_ASSETS } from '../../assets/manifest'

function createFakeAudioContext() {
  const calls: { createBufferSource: number; createGain: number; decodeAudioData: number } = {
    createBufferSource: 0,
    createGain: 0,
    decodeAudioData: 0,
  }
  const gainNodes: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = []
  const bufferSources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }[] = []

  const audioContext: AudioContextLike = {
    currentTime: 0,
    createBufferSource: () => {
      calls.createBufferSource++
      const node = { buffer: null, connect: vi.fn(), start: vi.fn() }
      bufferSources.push(node)
      return node
    },
    createGain: () => {
      calls.createGain++
      const node = { gain: { value: 1 }, connect: vi.fn() }
      gainNodes.push(node)
      return node
    },
    decodeAudioData: () => {
      calls.decodeAudioData++
      return Promise.resolve({})
    },
    destination: {},
  }

  return { audioContext, calls, gainNodes, bufferSources }
}

describe('createSfxEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loadAll fetches and decodes one buffer per manifest entry', async () => {
    const { audioContext, calls } = createFakeAudioContext()
    const fetchArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const engine = createSfxEngine({ audioContext, fetchArrayBuffer, getSongAudioElement: () => null })

    await engine.loadAll()

    expect(fetchArrayBuffer).toHaveBeenCalledTimes(SFX_ASSETS.length)
    expect(calls.decodeAudioData).toBe(SFX_ASSETS.length)
  })

  it('play() creates a buffer source routed through the SFX gain node and starts it', async () => {
    const { audioContext, calls, bufferSources } = createFakeAudioContext()
    const fetchArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const engine = createSfxEngine({ audioContext, fetchArrayBuffer, getSongAudioElement: () => null })
    await engine.loadAll()

    engine.play('hit_perfect')

    expect(calls.createBufferSource).toBe(1)
    expect(bufferSources[0].connect).toHaveBeenCalled()
    expect(bufferSources[0].start).toHaveBeenCalled()
  })

  it('play() dips the song element volume and restores it afterward', async () => {
    const { audioContext } = createFakeAudioContext()
    const fetchArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const songElement = { volume: 1 }
    const engine = createSfxEngine({ audioContext, fetchArrayBuffer, getSongAudioElement: () => songElement })
    await engine.loadAll()

    engine.play('hit_perfect')

    expect(songElement.volume).toBeLessThan(1)

    vi.advanceTimersByTime(2000)

    expect(songElement.volume).toBe(1)
  })

  it('setVolume updates the SFX gain node value', async () => {
    const { audioContext, gainNodes } = createFakeAudioContext()
    const fetchArrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const engine = createSfxEngine({ audioContext, fetchArrayBuffer, getSongAudioElement: () => null })
    await engine.loadAll()

    engine.setVolume(0.5)

    expect(gainNodes[0].gain.value).toBe(0.5)
  })
})
