import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OutputLatencyStep } from '../OutputLatencyStep'
import type { AudioContextLike } from '../../fx/audio/sfxEngine'

function createFakeAudioContext(currentTime: number): AudioContextLike {
  return {
    currentTime,
    createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: vi.fn() }),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    decodeAudioData: () => Promise.resolve({}),
    destination: {},
  }
}

describe('OutputLatencyStep', () => {
  it('completes with an outputOffsetMs close to a known constant bias between taps and clicks', () => {
    const audioContext = createFakeAudioContext(0)
    const onComplete = vi.fn()
    const KNOWN_OFFSET_MS = 45
    let tapIndex = 0
    // Clicks land at 0, 500, 1000, 1500ms (beatCount=4, intervalSec=0.5); every
    // tap arrives KNOWN_OFFSET_MS after its corresponding click.
    const now = () => {
      const t = tapIndex * 500 + KNOWN_OFFSET_MS
      tapIndex++
      return t
    }

    render(
      <OutputLatencyStep
        audioContext={audioContext}
        clickBuffer={{}}
        onComplete={onComplete}
        beatCount={4}
        intervalSec={0.5}
        now={now}
        clocks={{ perfNow: () => 0, wallNow: () => 0 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /start/i }))

    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(window, { key: ' ' })
    }

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]).toBeCloseTo(KNOWN_OFFSET_MS, 5)
  })

  it('measures a sane offset with realistic, unrelated AudioContext / performance.now() origins', () => {
    // Context created 12.3 s after its own origin; the page loaded 95 s ago.
    // The old code compared ctx.currentTime*1000 (12 300) against
    // performance.now() (~95 000) and reported ~83 s of speaker delay.
    const audioContext = createFakeAudioContext(12.3)
    const onComplete = vi.fn()
    const PERF0 = 95_000
    const KNOWN_OFFSET_MS = 70
    let tapIndex = 0
    const now = () => PERF0 + tapIndex++ * 500 + KNOWN_OFFSET_MS

    render(
      <OutputLatencyStep
        audioContext={audioContext}
        clickBuffer={{}}
        onComplete={onComplete}
        beatCount={4}
        intervalSec={0.5}
        now={now}
        clocks={{ perfNow: () => PERF0, wallNow: () => 1_791_000_000_000 }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    for (let i = 0; i < 4; i++) fireEvent.keyDown(window, { key: ' ' })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]).toBeCloseTo(KNOWN_OFFSET_MS, 5)
  })
})
