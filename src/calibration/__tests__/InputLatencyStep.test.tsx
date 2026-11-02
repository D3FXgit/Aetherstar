import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { InputLatencyStep } from '../InputLatencyStep'
import { usePitchStore } from '../../audio/pitchStore'
import type { AudioContextLike } from '../../fx/audio/sfxEngine'
import type { PitchSample } from '../../contracts/types'

function createFakeAudioContext(currentTime: number): AudioContextLike {
  return {
    currentTime,
    createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: vi.fn() }),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    decodeAudioData: () => Promise.resolve({}),
    destination: {},
  }
}

function sample(t: number, confidence: number): PitchSample {
  return { t, hz: 220, confidence, deviceId: 'mic-1' }
}

afterEach(() => {
  usePitchStore.setState({ activeCaptures: {} })
})

describe('InputLatencyStep', () => {
  it('completes with an inputOffsetMs close to the synthetic offset between clicks and detected taps', () => {
    const audioContext = createFakeAudioContext(0)
    const onComplete = vi.fn()
    const KNOWN_OFFSET_MS = 60

    render(
      <InputLatencyStep
        audioContext={audioContext}
        clickBuffer={{}}
        deviceId="mic-1"
        onComplete={onComplete}
        beatCount={3}
        intervalSec={0.5}
        clocks={{ perfNow: () => 0, wallNow: () => 0 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /start/i }))

    // Clicks land at 0, 500, 1000ms (beatCount=3, intervalSec=0.5); each vocalized
    // tap's confidence rises KNOWN_OFFSET_MS after its click, with a low-confidence
    // dip beforehand so detectTapTimestamps sees a real rising edge per tap.
    const samples = [0, 500, 1000].flatMap((clickMs) => [sample(clickMs - 50, 0.05), sample(clickMs + KNOWN_OFFSET_MS, 0.9)])

    act(() => {
      usePitchStore.setState({
        activeCaptures: { 'mic-1': { latest: samples[samples.length - 1], samples, latencyMs: null } },
      })
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]).toBeCloseTo(KNOWN_OFFSET_MS, 5)
  })

  it('times clicks and taps on the epoch clock PitchSample.t uses, ignoring what the mic heard before Start', () => {
    // Realistic origins: AudioContext 12.3 s old, page loaded 95 s ago, and
    // native PitchSample.t in epoch ms. The old code subtracted 12 300 from
    // ~1.79e12 and stored a mic delay of ~1.79e12 ms.
    const audioContext = createFakeAudioContext(12.3)
    const onComplete = vi.fn()
    const WALL0 = 1_791_000_000_000
    const KNOWN_OFFSET_MS = 140

    render(
      <InputLatencyStep
        audioContext={audioContext}
        clickBuffer={{}}
        deviceId="mic-1"
        onComplete={onComplete}
        beatCount={3}
        intervalSec={0.5}
        clocks={{ perfNow: () => 95_000, wallNow: () => WALL0 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /start/i }))

    // Chatter picked up before Start: three clear rising edges that would
    // otherwise be read as the first taps.
    const stale = [-900, -600, -300].flatMap((ms) => [sample(WALL0 + ms - 50, 0.05), sample(WALL0 + ms, 0.9)])
    const taps = [0, 500, 1000].flatMap((clickMs) => [
      sample(WALL0 + clickMs + 10, 0.05),
      sample(WALL0 + clickMs + KNOWN_OFFSET_MS, 0.9),
    ])
    const samples = [...stale, ...taps]

    act(() => {
      usePitchStore.setState({
        activeCaptures: { 'mic-1': { latest: samples[samples.length - 1], samples, latencyMs: null } },
      })
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]).toBeCloseTo(KNOWN_OFFSET_MS, 5)
  })
})
