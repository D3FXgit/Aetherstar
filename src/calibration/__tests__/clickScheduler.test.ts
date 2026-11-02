import { describe, expect, it, vi } from 'vitest'
import { scheduleClicks } from '../clickScheduler'
import type { AudioContextLike } from '../../fx/audio/sfxEngine'

function createFakeAudioContext(currentTime: number) {
  const bufferSources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }[] = []

  const audioContext: AudioContextLike = {
    currentTime,
    createBufferSource: () => {
      const node = { buffer: null, connect: vi.fn(), start: vi.fn() }
      bufferSources.push(node)
      return node
    },
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    decodeAudioData: () => Promise.resolve({}),
    destination: {},
  } as unknown as AudioContextLike

  return { audioContext, bufferSources }
}

describe('scheduleClicks', () => {
  it('schedules `count` clicks spaced `intervalSec` apart, starting from audioContext.currentTime', () => {
    const { audioContext, bufferSources } = createFakeAudioContext(10)
    const clickBuffer = {}

    const clocks = { perfNow: () => 0, wallNow: () => 0 }
    const { perfMs } = scheduleClicks({ audioContext, clickBuffer, count: 8, intervalSec: 0.5, clocks })

    expect(bufferSources).toHaveLength(8)
    bufferSources.forEach((source, i) => {
      expect(source.buffer).toBe(clickBuffer)
      expect(source.connect).toHaveBeenCalled()
      expect(source.start).toHaveBeenCalledWith(10 + i * 0.5)
    })

    expect(perfMs).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500])
  })

  it('re-expresses click times on the performance.now() and epoch timelines, not the AudioContext origin', () => {
    // Realistic, unrelated origins: the context was created 12.3 s ago, the
    // page loaded 83 s ago, and the wall clock is a 2026 epoch timestamp.
    const { audioContext } = createFakeAudioContext(12.3)
    const PERF0 = 83_000.25
    const WALL0 = 1_791_000_000_000
    const result = scheduleClicks({
      audioContext,
      clickBuffer: {},
      count: 3,
      intervalSec: 0.5,
      clocks: { perfNow: () => PERF0, wallNow: () => WALL0 },
    })

    expect(result.perfMs).toEqual([PERF0, PERF0 + 500, PERF0 + 1000])
    expect(result.wallMs).toEqual([WALL0, WALL0 + 500, WALL0 + 1000])
    expect(result.wallStartMs).toBe(WALL0)
  })

  it('reads each clock once, so a clock ticking during scheduling does not skew the click spacing', () => {
    const { audioContext } = createFakeAudioContext(5)
    let perf = 1000
    let wall = 1_791_000_000_000
    const result = scheduleClicks({
      audioContext,
      clickBuffer: {},
      count: 3,
      intervalSec: 0.25,
      clocks: { perfNow: () => perf++, wallNow: () => wall++ },
    })
    expect(result.perfMs).toEqual([1000, 1250, 1500])
    expect(result.wallMs).toEqual([1_791_000_000_000, 1_791_000_000_250, 1_791_000_000_500])
  })
})
